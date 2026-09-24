from pathlib import Path
from decouple import Config, RepositoryEnv
from nimbasms import Client

BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"

config = Config(RepositoryEnv(str(ENV_FILE)))

SID = config("NIMBA_SERVICE_ID")
TOKEN = config("NIMBA_SECRET_TOKEN")

client = Client(SID, TOKEN)

numero = "+224624086668"

print("Envoi du SMS...")
print("Destinataire :", numero)

try:
    response = client.messages.create(
        to=[numero],
        sender_name="TALY SCHOOL",
        message="Test SMS depuis TALY SCHOOL."
    )

    print()
    print("Réponse Nimba :")
    print("OK :", response.ok)
    print("Données :", response.data)

except Exception as e:
    print()
    print("ERREUR NIMBA :")
    print(type(e).__name__, e)