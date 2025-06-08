FROM python:3.9-slim

# Install necessary packages
RUN apt-get update && apt-get install -y \
    xvfb \
    x11vnc \
    novnc \
    python3-tk \
    supervisor \
    procps \
    websockify \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application files
COPY . .

# Copy supervisor configuration
COPY supervisor.conf /etc/supervisor/conf.d/supervisord.conf

# Set environment variable for display
ENV DISPLAY=:1

# Expose ports
EXPOSE 502 5900 6080

# Start services using supervisor
CMD ["supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]