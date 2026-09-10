import os
import platform
import shutil
import sys
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import django
from django.conf import settings
from django.core.management import call_command
from django.db.models import Count, Q, Sum
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from academics.models import Classe, Creneau
from accounts.models import User
from accounts.permissions import IsSuperAdmin
from announcements.models import Annonce
from attendance.models import Presence
from grades.models import Note, Periode
from payments.models import Frais, Paiement
from people.models import AlerteParent, EleveProfile, EnseignantProfile, PaieEnseignant
from tenants.models import Ecole

from .models import SauvegardeLog
from .serializers import SauvegardeLogSerializer


class DashboardView(APIView):
    """Retourne un résumé adapté au rôle de l'utilisateur connecté."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        if user.role == "admin":
            return Response(self._admin_dashboard(user))
        if user.role == "teacher":
            return Response(self._teacher_dashboard(user))
        if user.role == "student":
            return Response(self._student_dashboard(user))
        if user.role == "parent":
            return Response(self._parent_dashboard(user))
        if user.role == "comptabilite":
            return Response(self._comptabilite_dashboard(user))
        if user.role == "surveillance":
            return Response(self._surveillance_dashboard(user))
        return Response({})

    def _admin_dashboard(self, user):
        ecole_id = user.ecole_id
        eleves_ecole = EleveProfile.objects.filter(user__ecole_id=ecole_id, actif=True)
        total_eleves = eleves_ecole.count()
        eleves_filles = eleves_ecole.filter(user__sexe="F").count()
        eleves_garcons = eleves_ecole.filter(user__sexe="M").count()

        enseignants_ecole = EnseignantProfile.objects.filter(user__ecole_id=ecole_id)
        total_enseignants = enseignants_ecole.count()
        enseignants_femmes = enseignants_ecole.filter(user__sexe="F").count()
        enseignants_hommes = enseignants_ecole.filter(user__sexe="M").count()

        classes_ecole = Classe.objects.filter(annee_scolaire__ecole_id=ecole_id)
        total_classes = classes_ecole.count()
        classes_par_niveau = list(
            classes_ecole.values("niveau").annotate(nb=Count("id")).order_by("niveau")
        )

        presence_totals = Presence.objects.filter(eleve__user__ecole_id=ecole_id).aggregate(
            total=Count("id"),
            presents=Count("id", filter=Q(statut=Presence.Statut.PRESENT)),
        )
        taux_presence = (
            round(presence_totals["presents"] / presence_totals["total"] * 100, 1)
            if presence_totals["total"] else None
        )

        total_attendu = Frais.objects.filter(eleve__user__ecole_id=ecole_id).aggregate(t=Sum("montant"))["t"] or Decimal("0")
        total_encaisse = Paiement.objects.filter(frais__eleve__user__ecole_id=ecole_id).aggregate(t=Sum("montant"))["t"] or Decimal("0")

        eleves_par_classe = list(
            classes_ecole.annotate(nb_eleves=Count("eleves")).values("nom", "nb_eleves").order_by("nom")
        )

        dernieres_annonces = list(
            Annonce.objects.filter(ecole_id=ecole_id).order_by("-date_publication")[:5].values(
                "id", "titre", "date_publication", "cible_role"
            )
        )

        return {
            "total_eleves": total_eleves,
            "eleves_filles": eleves_filles,
            "eleves_garcons": eleves_garcons,
            "total_enseignants": total_enseignants,
            "enseignants_femmes": enseignants_femmes,
            "enseignants_hommes": enseignants_hommes,
            "total_classes": total_classes,
            "classes_par_niveau": classes_par_niveau,
            "taux_presence_global": taux_presence,
            "total_attendu": total_attendu,
            "total_encaisse": total_encaisse,
            "taux_recouvrement": (
                round(float(total_encaisse) / float(total_attendu) * 100, 1) if total_attendu else None
            ),
            "eleves_par_classe": eleves_par_classe,
            "dernieres_annonces": dernieres_annonces,
        }

    def _teacher_dashboard(self, user):
        enseignements = user.enseignements.select_related("classe", "matiere")
        classes = {e.classe for e in enseignements}
        jours_fr = {
            "monday": "lundi", "tuesday": "mardi", "wednesday": "mercredi",
            "thursday": "jeudi", "friday": "vendredi", "saturday": "samedi", "sunday": "dimanche",
        }
        jour_actuel = jours_fr.get(date.today().strftime("%A").lower(), "lundi")

        creneaux_du_jour = list(
            Creneau.objects.filter(enseignement__enseignant=user, jour=jour_actuel)
            .select_related("classe", "enseignement__matiere")
            .order_by("heure_debut")
            .values("id", "classe__nom", "enseignement__matiere__nom", "heure_debut", "heure_fin", "salle")
        )

        dernieres_notes = list(
            Note.objects.filter(enseignant=user).order_by("-date")[:5]
            .values("id", "eleve__user__first_name", "eleve__user__last_name", "matiere__nom", "valeur", "date")
        )

        return {
            "nombre_classes": len(classes),
            "nombre_matieres": enseignements.values("matiere").distinct().count(),
            "creneaux_du_jour": creneaux_du_jour,
            "dernieres_notes": dernieres_notes,
            "classes": [{"id": c.id, "nom": c.nom, "effectif": c.effectif} for c in classes],
        }

    def _student_dashboard(self, user):
        eleve = getattr(user, "eleve_profile", None)
        if not eleve:
            return {}
        # On privilégie la dernière période où l'élève a effectivement des notes ;
        # à défaut (ex: tout début d'année) on retombe sur la période la plus récente.
        periode = (
            Periode.objects.filter(annee_scolaire__active=True, notes__eleve=eleve)
            .order_by("-date_debut").distinct().first()
            or Periode.objects.filter(annee_scolaire__active=True).order_by("-date_debut").first()
        )
        moyenne_generale = None
        if periode:
            notes = Note.objects.filter(eleve=eleve, periode=periode)
            if notes.exists():
                total, coeffs = Decimal("0"), Decimal("0")
                for matiere_id in notes.values_list("matiere", flat=True).distinct():
                    notes_matiere = notes.filter(matiere_id=matiere_id)
                    coeff_matiere = notes_matiere.first().matiere.coefficient
                    total_points = sum(n.valeur * n.coefficient for n in notes_matiere)
                    total_coeff = sum(n.coefficient for n in notes_matiere)
                    if total_coeff:
                        moyenne_matiere = total_points / total_coeff
                        total += moyenne_matiere * coeff_matiere
                        coeffs += coeff_matiere
                if coeffs:
                    moyenne_generale = round(total / coeffs, 2)

        presence_totals = Presence.objects.filter(eleve=eleve).aggregate(
            total=Count("id"), presents=Count("id", filter=Q(statut=Presence.Statut.PRESENT))
        )
        taux_presence = (
            round(presence_totals["presents"] / presence_totals["total"] * 100, 1)
            if presence_totals["total"] else None
        )

        solde_frais = Frais.objects.filter(eleve=eleve).aggregate(t=Sum("montant"))["t"] or Decimal("0")
        paye_frais = Paiement.objects.filter(frais__eleve=eleve).aggregate(t=Sum("montant"))["t"] or Decimal("0")

        prochains_creneaux = []
        if eleve.classe:
            prochains_creneaux = list(
                Creneau.objects.filter(classe=eleve.classe)
                .select_related("enseignement__matiere")
                .order_by("jour", "heure_debut")[:5]
                .values("jour", "heure_debut", "heure_fin", "enseignement__matiere__nom", "salle")
            )

        return {
            "moyenne_generale": moyenne_generale,
            "taux_presence": taux_presence,
            "solde_frais": solde_frais - paye_frais,
            "prochains_creneaux": prochains_creneaux,
            "classe": eleve.classe.nom if eleve.classe else None,
        }

    def _parent_dashboard(self, user):
        enfants = EleveProfile.objects.filter(parent=user).select_related("user", "classe")
        resultats = []
        for enfant in enfants:
            presence_totals = Presence.objects.filter(eleve=enfant).aggregate(
                total=Count("id"), presents=Count("id", filter=Q(statut=Presence.Statut.PRESENT))
            )
            taux_presence = (
                round(presence_totals["presents"] / presence_totals["total"] * 100, 1)
                if presence_totals["total"] else None
            )
            solde_frais = Frais.objects.filter(eleve=enfant).aggregate(t=Sum("montant"))["t"] or Decimal("0")
            paye_frais = Paiement.objects.filter(frais__eleve=enfant).aggregate(t=Sum("montant"))["t"] or Decimal("0")
            resultats.append({
                "id": enfant.id,
                "nom_complet": enfant.user.get_full_name(),
                "classe": enfant.classe.nom if enfant.classe else None,
                "taux_presence": taux_presence,
                "solde_frais": solde_frais - paye_frais,
            })
        return {"enfants": resultats}

    def _comptabilite_dashboard(self, user):
        ecole_id = user.ecole_id
        total_attendu = Frais.objects.filter(eleve__user__ecole_id=ecole_id).aggregate(t=Sum("montant"))["t"] or Decimal("0")
        total_encaisse = Paiement.objects.filter(frais__eleve__user__ecole_id=ecole_id).aggregate(t=Sum("montant"))["t"] or Decimal("0")

        # On évite d'agréger frais et paiements en une seule requête jointe (les jointures
        # multiples sur deux relations inverses gonflent les sommes en cas de lignes multiples) :
        # on calcule le solde élève par élève, comme dans FraisViewSet.summary.
        frais_qs = Frais.objects.filter(eleve__user__ecole_id=ecole_id, eleve__actif=True)
        nb_impayes = 0
        for eleve_id in frais_qs.values_list("eleve_id", flat=True).distinct():
            du = frais_qs.filter(eleve_id=eleve_id).aggregate(t=Sum("montant"))["t"] or Decimal("0")
            paye = Paiement.objects.filter(frais__eleve_id=eleve_id, frais__eleve__user__ecole_id=ecole_id).aggregate(t=Sum("montant"))["t"] or Decimal("0")
            if paye < du:
                nb_impayes += 1

        paies_en_attente = PaieEnseignant.objects.filter(
            enseignant__user__ecole_id=ecole_id, payee=False
        ).count()

        derniers_paiements = list(
            Paiement.objects.filter(frais__eleve__user__ecole_id=ecole_id)
            .select_related("frais__eleve__user")
            .order_by("-date_paiement")[:5]
            .values("id", "montant", "date_paiement", "frais__eleve__user__first_name", "frais__eleve__user__last_name")
        )

        return {
            "total_attendu": total_attendu,
            "total_encaisse": total_encaisse,
            "solde_total": total_attendu - total_encaisse,
            "taux_recouvrement": (
                round(float(total_encaisse) / float(total_attendu) * 100, 1) if total_attendu else None
            ),
            "nb_eleves_impayes": nb_impayes,
            "paies_enseignants_en_attente": paies_en_attente,
            "derniers_paiements": derniers_paiements,
        }

    def _surveillance_dashboard(self, user):
        ecole_id = user.ecole_id
        today = date.today()

        presence_totals = Presence.objects.filter(eleve__user__ecole_id=ecole_id).aggregate(
            total=Count("id"), presents=Count("id", filter=Q(statut=Presence.Statut.PRESENT)),
        )
        taux_presence = (
            round(presence_totals["presents"] / presence_totals["total"] * 100, 1)
            if presence_totals["total"] else None
        )

        absents_du_jour = Presence.objects.filter(
            eleve__user__ecole_id=ecole_id, date=today, statut=Presence.Statut.ABSENT,
        ).count()

        alertes_recentes = list(
            AlerteParent.objects.filter(eleve__user__ecole_id=ecole_id).select_related("eleve__user")
            .order_by("-cree_le")[:5]
            .values("id", "type", "message", "cree_le", "eleve__user__first_name", "eleve__user__last_name")
        )

        total_eleves = EleveProfile.objects.filter(user__ecole_id=ecole_id, actif=True).count()

        return {
            "total_eleves": total_eleves,
            "taux_presence_global": taux_presence,
            "absents_du_jour": absents_du_jour,
            "alertes_recentes": alertes_recentes,
        }


class SauvegardeViewSet(viewsets.ReadOnlyModelViewSet):
    """Historique des sauvegardes journalières de la plateforme — réservé au Super Admin."""

    queryset = SauvegardeLog.objects.all()
    serializer_class = SauvegardeLogSerializer
    permission_classes = [IsSuperAdmin]

    @action(detail=False, methods=["post"], url_path="lancer")
    def lancer(self, request):
        """Déclenche une sauvegarde immédiate (en plus de la tâche planifiée quotidienne)."""
        call_command("backup_daily")
        dernier = SauvegardeLog.objects.first()
        return Response(SauvegardeLogSerializer(dernier).data, status=201)

    @action(detail=True, methods=["get"], url_path="telecharger")
    def telecharger(self, request, pk=None):
        log = self.get_object()
        if not log.fichier:
            raise Http404("Aucun fichier associé à cette sauvegarde.")
        chemin = Path(settings.BASE_DIR) / "backups" / log.fichier
        if not chemin.exists():
            raise Http404("Le fichier de sauvegarde n'est plus disponible sur le serveur.")
        return FileResponse(open(chemin, "rb"), as_attachment=True, filename=log.fichier)


def _taille_dossier(chemin: Path) -> int:
    if not chemin.exists():
        return 0
    total = 0
    for dossier, _sous_dossiers, fichiers in os.walk(chemin):
        for nom in fichiers:
            try:
                total += os.path.getsize(os.path.join(dossier, nom))
            except OSError:
                pass  # fichier supprimé/inaccessible entre le listing et la lecture — ignoré
    return total


class SupervisionView(APIView):
    """Santé technique de la plateforme (volumétrie, sauvegardes, sécurité, activité) —
    réservée au Super Admin. Pas d'infrastructure de monitoring externe (pas de Celery, pas de
    suivi d'erreurs/APM) : tout ce qui est renvoyé ici est calculé à la volée à partir de ce que
    Django/le système d'exploitation exposent directement — pas d'historique de charge/latence."""

    permission_classes = [IsSuperAdmin]

    def get(self, request):
        try:
            taille_bdd = os.path.getsize(settings.DATABASES["default"]["NAME"])
        except (OSError, TypeError, KeyError):
            taille_bdd = 0  # moteur non-fichier (Postgres/MySQL en prod) ou chemin indisponible

        dernieres_sauvegardes = list(SauvegardeLog.objects.all()[:5])

        derniere_reussie = SauvegardeLog.objects.filter(statut=SauvegardeLog.Statut.SUCCES).first()
        jours_depuis_sauvegarde = None
        if derniere_reussie:
            jours_depuis_sauvegarde = (timezone.now() - derniere_reussie.date_lancement).days

        try:
            disque = shutil.disk_usage(settings.BASE_DIR)
            disque_data = {
                "total_octets": disque.total, "utilise_octets": disque.used, "libre_octets": disque.free,
            }
        except OSError:
            disque_data = None

        maintenant = timezone.now()
        utilisateurs_actifs_24h = User.objects.filter(last_login__gte=maintenant - timedelta(hours=24)).count()
        utilisateurs_actifs_7j = User.objects.filter(last_login__gte=maintenant - timedelta(days=7)).count()
        jamais_connectes = User.objects.filter(last_login__isnull=True).count()

        # Top 5 écoles par nombre d'utilisateurs — repère rapide des établissements les plus
        # volumineux/actifs sans avoir à ouvrir la liste complète des écoles.
        top_ecoles = (
            Ecole.objects.annotate(nb_utilisateurs=Count("users"))
            .order_by("-nb_utilisateurs")[:5]
            .values("id", "nom", "nb_utilisateurs")
        )

        return Response({
            "taille_base_donnees_octets": taille_bdd,
            "taille_media_octets": _taille_dossier(Path(settings.MEDIA_ROOT)),
            "nombre_ecoles": Ecole.objects.count(),
            "nombre_ecoles_actives": Ecole.objects.filter(actif=True).count(),
            "nombre_utilisateurs_total": User.objects.count(),
            "version_django": django.get_version(),
            "version_python": platform.python_version(),
            "dernieres_sauvegardes": SauvegardeLogSerializer(dernieres_sauvegardes, many=True).data,
            # --- Environnement & sécurité ---
            "debug_actif": settings.DEBUG,
            "moteur_base_donnees": settings.DATABASES["default"]["ENGINE"].rsplit(".", 1)[-1],
            "plateforme_serveur": platform.platform(),
            "interpreteur_python": sys.implementation.name,
            "disque": disque_data,
            # --- Activité des comptes ---
            "utilisateurs_actifs_24h": utilisateurs_actifs_24h,
            "utilisateurs_actifs_7j": utilisateurs_actifs_7j,
            "utilisateurs_jamais_connectes": jamais_connectes,
            # --- Sauvegardes ---
            "jours_depuis_derniere_sauvegarde_reussie": jours_depuis_sauvegarde,
            # --- Répartition ---
            "top_ecoles": list(top_ecoles),
        })
