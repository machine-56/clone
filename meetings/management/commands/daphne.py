from django.core.management.base import BaseCommand
import os
import subprocess

class Command(BaseCommand):
    help = "Run Daphne ASGI server"

    def handle(self, *args, **options):
        os.environ.setdefault("DJANGO_SETTINGS_MODULE", "connectly.settings")
        try:
            subprocess.run([
                "python", "-m", "daphne",
                "-b", "0.0.0.0",
                "-p", "8000",
                "connectly.asgi:application"
            ])
        except KeyboardInterrupt:
            # Quiet shutdown
            self.stdout.write(self.style.WARNING("\nServer stopped by keyboard interrupt."))

