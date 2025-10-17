import os
import django
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from django.core.asgi import get_asgi_application
import meetings.routing

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "connectly.settings")
django.setup()

application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": AuthMiddlewareStack(
        URLRouter(meetings.routing.websocket_urlpatterns)
    ),
})
