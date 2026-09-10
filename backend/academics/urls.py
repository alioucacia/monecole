from rest_framework.routers import DefaultRouter

from .views import AnneeScolaireViewSet, ClasseViewSet, CreneauViewSet, EnseignementViewSet, MatiereViewSet

router = DefaultRouter()
router.register("annees-scolaires", AnneeScolaireViewSet, basename="annee-scolaire")
router.register("matieres", MatiereViewSet, basename="matiere")
router.register("classes", ClasseViewSet, basename="classe")
router.register("enseignements", EnseignementViewSet, basename="enseignement")
router.register("creneaux", CreneauViewSet, basename="creneau")

urlpatterns = router.urls
