FROM python:3.14-slim-bookworm

LABEL org.opencontainers.image.licenses="MIT"
COPY LICENSE /usr/share/licenses/scoretrackrr/LICENSE

WORKDIR /app
RUN pip install --no-cache-dir bleak==3.1.0
COPY docker/granboard/relay.py /app/relay.py
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 1000:1000
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["python", "-c", "from urllib.request import urlopen; urlopen('http://127.0.0.1:8081/api/granboard/status', timeout=3).close()"]
CMD ["python", "/app/relay.py"]
