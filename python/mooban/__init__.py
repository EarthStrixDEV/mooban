from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

from . import config, db, http, spa
from .routes import comments, likes, ping, posts, users


def create_app():
    app = Flask(__name__, static_folder=None)
    app.config['MAX_CONTENT_LENGTH'] = config.MAX_CONTENT_LENGTH
    app.config['PROPAGATE_EXCEPTIONS'] = False
    app.url_map.merge_slashes = False
    app.response_class = http.JsonResponse
    if config.TRUST_PROXY:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1)  # exactly one proxy hop

    app.teardown_appcontext(db.close)
    http.init_app(app)

    with app.app_context():  # route() stores the table on the app
        ping.register()
        users.register()
        posts.register()
        likes.register()
        comments.register()
    # later tasks register images, tools, stream, test routes, /media and /ws here

    spa.init_app(app)
    return app
