FROM ruby:3.1-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    curl \
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

# Default command
CMD ["bundle", "exec", "jekyll", "serve", "--host", "0.0.0.0", "--livereload"]