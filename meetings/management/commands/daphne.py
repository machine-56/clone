from django.core.management.base import BaseCommand
import os
import subprocess

class Command(BaseCommand):
    help = "Run Daphne ASGI server on 127.0.0.1:8001 for production"

    def handle(self, *args, **options):
        os.environ.setdefault("DJANGO_SETTINGS_MODULE", "connectly.settings")

        host = "127.0.0.1"
        port = "8000"

        self.stdout.write(self.style.SUCCESS(f"Starting Daphne on {host}:{port}"))

        try:
            subprocess.run([
                "python", "-m", "daphne",
                "-b", host,
                "-p", port,
                "connectly.asgi:application"
            ])
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("Server stopped manually."))
