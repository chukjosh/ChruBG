"""Single process server for Docker or local use. Serves the web page and the API on one port."""
import os
import sys
import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PROJECT_ROOT_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIRECTORY = os.path.join(PROJECT_ROOT_DIRECTORY, "public")
API_PATH = "/api/remove_background"
VIDEO_PATH = "/api/video_local"
VIDEO_BACKGROUND_PATH = "/api/video_local/background"
sys.path.insert(0, os.path.join(PROJECT_ROOT_DIRECTORY, "api"))

from local_video import get_local_video_status, handle_background_post, handle_video_post  # noqa: E402
from remove_background import handler as api_handler  # noqa: E402


mimetypes.add_type("application/manifest+json", ".webmanifest")


class LocalServerHandler(api_handler, SimpleHTTPRequestHandler):
    def __init__(self, *arguments, **keyword_arguments):
        super().__init__(*arguments, directory=PUBLIC_DIRECTORY, **keyword_arguments)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

    def is_api_request(self):
        return self.path.split("?")[0] == API_PATH

    def is_video_request(self):
        return self.path.split("?")[0] == VIDEO_PATH

    def do_GET(self):
        if self.is_video_request():
            self.send_json(200, get_local_video_status())
        elif self.is_api_request():
            api_handler.do_GET(self)
        else:
            SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        if self.path.split("?")[0] == VIDEO_BACKGROUND_PATH:
            handle_background_post(self)
        elif self.is_video_request():
            handle_video_post(self)
        elif self.is_api_request():
            api_handler.do_POST(self)
        else:
            self.send_error(404)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"ChruBG running on http://localhost:{port}")
    ThreadingHTTPServer(("0.0.0.0", port), LocalServerHandler).serve_forever()
