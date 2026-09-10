from django.contrib.auth.backends import ModelBackend
from django.db.models import Q

from .models import User


class MultiFieldAuthBackend(ModelBackend):
    """Permet de se connecter avec le nom d'utilisateur, l'e-mail ou le numéro de téléphone.

    Le formulaire de connexion ne change pas (un seul champ "identifiant" + mot de passe) :
    on cherche simplement l'utilisateur correspondant parmi les trois champs avant de
    vérifier le mot de passe. En cas d'ambiguïté (plusieurs comptes partageant le même
    téléphone) ou d'identifiant vide, l'authentification échoue silencieusement, comme un
    identifiant inconnu — on ne doit jamais révéler pourquoi une connexion a échoué.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        identifiant = username or kwargs.get(User.USERNAME_FIELD)
        if not identifiant or not password:
            return None

        try:
            user = User.objects.get(
                Q(username__iexact=identifiant)
                | Q(email__iexact=identifiant)
                | Q(phone=identifiant)
            )
        except (User.DoesNotExist, User.MultipleObjectsReturned):
            return None

        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
