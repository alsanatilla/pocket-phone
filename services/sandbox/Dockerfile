# Pip's sandbox: a separate Fly machine where the code Pip writes runs, reached only over SSH on Fly's private
# network by OpenClaw's SSH sandbox backend. It holds no Pocket secret: not the database token, not the encryption
# secret, not a provider key. What it needs for that backend: /bin/sh, python3, GNU stat and readlink.
#   fly deploy -c services/sandbox/fly.toml        (from the repository root)
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-server ca-certificates coreutils curl git jq unzip zip less file \
      python3 python3-pip python3-venv python3-numpy python3-pandas python3-matplotlib python3-requests python3-bs4 python3-lxml \
      nodejs npm sqlite3 \
    && rm -rf /var/lib/apt/lists/* /etc/ssh/ssh_host_* \
    && useradd --create-home --home-dir /home/pip --shell /bin/bash --uid 1000 pip \
    && usermod -p '*' pip \
    && mkdir -p /run/sshd /workspace && chown pip:pip /workspace
RUN groupadd pip-sandbox
COPY accounts.py /usr/local/bin/accounts.py
COPY sshd_config /etc/ssh/sshd_config
COPY start.sh /usr/local/bin/start.sh
RUN chmod 755 /usr/local/bin/start.sh
EXPOSE 2222
CMD ["/usr/local/bin/start.sh"]
