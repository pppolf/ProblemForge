FROM criyle/go-judge:v1.8.5@sha256:5e4509290e22442a839c53ca021ba64ece7559bbd709e65c11194c753fb0f1f3
# Versions are tied to Debian bookworm's TeX Live 2022, not an unbounded texlive-full.
USER root
ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=http://deb.debian.org/debian-security
RUN --mount=type=cache,id=problemforge-tex-apt-archives,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=problemforge-tex-apt-lists,target=/var/lib/apt/lists,sharing=locked \
    sed -i "s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g; s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && rm -f /etc/apt/apt.conf.d/docker-clean \
    && printf 'Acquire::Retries "3";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::http::Pipeline-Depth "0";\n' > /etc/apt/apt.conf.d/80problemforge-network \
    && apt-get update && apt-get install -y --no-install-recommends \
    texlive-xetex=2022.20230122-3 texlive-lang-chinese=2022.20230122-1 \
    texlive-latex-extra=2022.20230122-4 texlive-fonts-recommended=2022.20230122-3 \
    latexmk=1:4.79-1 fonts-noto-cjk=1:20220127+repack1-1 fonts-dejavu-core=2.37-6 fontconfig=2.14.1-4 \
    texlive-science=2022.20230122-4 texlive-humanities=2022.20230122-4 \
    && fc-cache -f && dpkg-query -W > /opt/toolchain-packages.txt
# science and humanities retain algorithm/algorithmic, flowchart and qtree from
# the supplied templates. Install together to run TeX's package triggers once.
COPY infra/tex-mount.yaml /opt/tex-mount.yaml
# Install system toolchain only at image build time; author code runs via go-judge.
