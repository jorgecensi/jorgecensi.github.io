FROM ruby:3.1-slim

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash -

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    curl \
    nodejs \
    npm \
    less \
    procps \
    sudo \
    fzf \
    zsh \
    man-db \
    unzip \
    gnupg2 \
    gh \
    jq \
    nano \
    vim \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /workspace

# Install bundler
RUN gem install bundler

# Copy Gemfile first for better caching
COPY Gemfile* ./

# Install gems
RUN bundle install

# Copy the rest of the Jekyll site
COPY . .

# Expose Jekyll default port
EXPOSE 4000

# Create npm global directory
RUN mkdir -p /usr/local/share/npm-global && \
    chmod 755 /usr/local/share/npm-global

# Install Claude Code globally
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin
RUN npm install -g @anthropic-ai/claude-code@latest

# Default command
CMD ["bundle", "exec", "jekyll", "serve", "--host", "0.0.0.0", "--livereload"]