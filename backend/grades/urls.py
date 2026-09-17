from rest_framework.routers import DefaultRouter

from django.urls import include, path

from .views import (
    AnalysePerformanceView,
    AttestationHonneurPdfView,
    BulletinPdfView,
    BulletinPublicPdfView,
    BulletinSendEmailView,
    BulletinSendSmsView,
    BulletinSendWhatsAppView,
    BulletinView,
    NoteViewSet,
    PeriodeViewSet,
    ResultatsExportView,
    ResultatsNotifierView,
    ResultatsPdfView,
    ResultatsView,
)

router = DefaultRouter()
router.register("periodes", PeriodeViewSet, basename="periode")
router.register("notes", NoteViewSet, basename="note")

urlpatterns = [
    path("bulletin/", BulletinView.as_view(), name="bulletin"),
    path("bulletin/pdf/", BulletinPdfView.as_view(), name="bulletin-pdf"),
    path("bulletin/send-email/", BulletinSendEmailView.as_view(), name="bulletin-send-email"),
    path("bulletin/send-sms/", BulletinSendSmsView.as_view(), name="bulletin-send-sms"),
    path("bulletin/send-whatsapp/", BulletinSendWhatsAppView.as_view(), name="bulletin-send-whatsapp"),
    path("bulletin/pdf/public/<str:token>/", BulletinPublicPdfView.as_view(), name="bulletin-pdf-public"),
    path("resultats/", ResultatsView.as_view(), name="resultats"),
    path("resultats/export/", ResultatsExportView.as_view(), name="resultats-export"),
    path("resultats/pdf/", ResultatsPdfView.as_view(), name="resultats-pdf"),
    path("resultats/attestations/", AttestationHonneurPdfView.as_view(), name="attestations-honneur"),
    path("resultats/notifier/", ResultatsNotifierView.as_view(), name="resultats-notifier"),
    path("analyse-performance/", AnalysePerformanceView.as_view(), name="analyse-performance"),
    path("", include(router.urls)),
]
