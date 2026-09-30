FROM python:3.12-slim
ARG AI_SOURCE
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home app
WORKDIR /app
COPY ${AI_SOURCE}/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY ${AI_SOURCE}/ ./
USER app
CMD ["python", "server.py"]
