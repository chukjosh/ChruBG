FROM python:3.12-slim
WORKDIR /app

# ffmpeg is needed for the local video mode
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Choose the models to bake into the image. The first one is the default.
ARG ENABLED_MODELS=isnet-general-use,silueta,u2netp
ENV ENABLED_MODELS=${ENABLED_MODELS}
RUN python3 scripts/download_model.py

ENV PORT=8000
EXPOSE 8000
CMD ["python3", "local_server.py"]
