import io
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import User
from tenants.models import Ecole


def _png(taille_octets: int) -> bytes:
    """PNG valide complété jusqu'à `taille_octets` (Pillow ignore les octets après IEND)."""
    tampon = io.BytesIO()
    Image.new("RGB", (10, 10)).save(tampon, format="PNG")
    contenu = tampon.getvalue()
    return contenu + b"\0" * max(0, taille_octets - len(contenu))


class TaillePhotoTests(TestCase):
    """Photo de compte limitée à 2 Mo (profil, fiche élève, fiche enseignant)."""

    def setUp(self):
        self._dossier = TemporaryDirectory(ignore_cleanup_errors=True)
        self._settings = override_settings(MEDIA_ROOT=Path(self._dossier.name))
        self._settings.enable()
        self.ecole = Ecole.objects.create(nom="Test", slug="test")
        self.admin = User.objects.create_user(username="ad", password="x", role="admin", ecole=self.ecole)
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.admin)

    def tearDown(self):
        self._settings.disable()
        self._dossier.cleanup()

    def test_photo_de_profil(self):
        trop_lourde = SimpleUploadedFile("p.png", _png(2 * 1024 * 1024 + 1), content_type="image/png")
        r = self.client_api.patch("/api/auth/me/", {"photo": trop_lourde}, format="multipart")
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("2 Mo", r.content.decode())

        legere = SimpleUploadedFile("p.png", _png(1024 * 1024), content_type="image/png")
        r = self.client_api.patch("/api/auth/me/", {"photo": legere}, format="multipart")
        self.assertEqual(r.status_code, 200, r.content)

    def test_photo_eleve_et_enseignant(self):
        from people.serializers import EleveProfileWriteSerializer, EnseignantProfileWriteSerializer

        for serializer in (EleveProfileWriteSerializer, EnseignantProfileWriteSerializer):
            with self.assertRaisesMessage(Exception, "2 Mo"):
                serializer().validate_photo(SimpleUploadedFile("p.png", _png(2 * 1024 * 1024 + 1)))
