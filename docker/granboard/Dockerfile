FROM python:3.14-slim-bookworm

WORKDIR /app
RUN pip install --no-cache-dir bleak==3.1.0
COPY relay.py /app/relay.py
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 1000:1000
EXPOSE 8081
CMD ["python", "/app/relay.py"]
