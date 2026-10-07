from django.core.management.base import BaseCommand, CommandError

from core.models import OperationSauvegardeEcole
from core.sauvegarde_ecole import executer


class Command(BaseCommand):
    help = (
        "Exécute une sauvegarde ou une restauration des données d'une école, lancée depuis la page "
        "« Sauvegarde & restauration » de son Administrateur (voir core/sauvegarde_ecole.py)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--operation-id", type=int, required=True)

    def handle(self, *args, **options):
        operation = OperationSauvegardeEcole.objects.select_related("ecole", "source").filter(
            pk=options["operation_id"], statut=OperationSauvegardeEcole.Statut.EN_COURS,
        ).first()
        if operation is None:
            raise CommandError(f"Aucune opération en cours n°{options['operation_id']}.")
        operation = executer(operation)
        if operation.statut != OperationSauvegardeEcole.Statut.SUCCES:
            raise CommandError(f"Échec : {operation.message}")
        self.stdout.write(self.style.SUCCESS(operation.message))
