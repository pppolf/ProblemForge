FROM criyle/go-judge:v1.8.5@sha256:5e4509290e22442a839c53ca021ba64ece7559bbd709e65c11194c753fb0f1f3
USER root
ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=http://deb.debian.org/debian-security
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    sed -i "s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g; s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get update && apt-get install -y --no-install-recommends \
    g++=4:12.2.0-3 g++-12=12.2.0-14+deb12u1 gcc-12=12.2.0-14+deb12u1 \
    python3=3.11.2-1+b1 python3.11=3.11.2-6+deb12u8 \
    openjdk-17-jdk-headless=17.0.20.1+1-1~deb12u1 openjdk-17-jre-headless=17.0.20.1+1-1~deb12u1 \
    && dpkg-query -W > /opt/toolchain-packages.txt
COPY --chmod=755 infra/java17-compile.sh /usr/local/bin/pf-javac17
COPY infra/judge-mount.yaml /opt/judge-mount.yaml
# Only image construction installs compilers. Worker never runs authors here via exec.
