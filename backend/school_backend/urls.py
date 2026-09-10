from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/academics/", include("academics.urls")),
    path("api/people/", include("people.urls")),
    path("api/grades/", include("grades.urls")),
    path("api/attendance/", include("attendance.urls")),
    path("api/payments/", include("payments.urls")),
    path("api/announcements/", include("announcements.urls")),
    path("api/library/", include("library.urls")),
    path("api/transport/", include("transport.urls")),
    path("api/cantine/", include("cantine.urls")),
    path("api/messaging/", include("messaging.urls")),
    path("api/visio/", include("visio.urls")),
    path("api/tenants/", include("tenants.urls")),
    path("api/dashboard/", include("core.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
