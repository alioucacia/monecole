from nimbasms import Client
from decouple import config

SID = config("NIMBASMS_SID")
TOKEN = config("NIMBASMS_SECRET_TOKEN")

client = Client(SID, TOKEN)

response = client.messages.create(
    to=["+224624086668"],
    sender_name="Taly School",
    message="Test SMS depuis mon application Monecole."
)

print("Réponse NimbaSMS :")
print(response)