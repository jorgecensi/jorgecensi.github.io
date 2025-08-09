// Flappy Bird PWA Game
class FlappyBird {
    constructor() {
        this.canvas = document.getElementById("canvas");
        this.ctx = this.canvas.getContext("2d");
        
        this.images = {};
        this.sounds = {};
        
        this.gameState = 'loading';
        this.score = 0;
        this.highScore = localStorage.getItem('flappyBirdHighScore') || 0;
        
        this.bird = {
            x: 50,
            y: 150,
            width: 34,
            height: 24,
            velocity: 0,
            gravity: 0.4,
            jump: 7
        };
        
        this.pipes = [];
        this.gap = 120;
        this.pipeWidth = 52;
        this.pipeSpeed = 2;
        
        this.ground = {
            x: 0,
            y: this.canvas.height - 112,
            height: 112
        };
        
        this.init();
    }
    
    async init() {
        await this.loadAssets();
        this.setupEventListeners();
        this.resetGame();
        this.gameLoop();
    }
    
    async loadAssets() {
        const imageFiles = [
            { key: 'bird', src: 'img/bird.png' },
            { key: 'bg', src: 'img/bg.png' },
            { key: 'fg', src: 'img/fg.png' },
            { key: 'pipeNorth', src: 'img/pipeNorth.png' },
            { key: 'pipeSouth', src: 'img/pipeSouth.png' }
        ];
        
        const soundFiles = [
            { key: 'fly', src: 'sounds/fly.mp3' },
            { key: 'score', src: 'sounds/score.mp3' }
        ];
        
        // Load images
        for (const file of imageFiles) {
            this.images[file.key] = new Image();
            this.images[file.key].src = file.src;
            await new Promise(resolve => {
                this.images[file.key].onload = resolve;
            });
        }
        
        // Load sounds
        for (const file of soundFiles) {
            this.sounds[file.key] = new Audio(file.src);
            this.sounds[file.key].preload = 'auto';
        }
        
        this.gameState = 'ready';
    }
    
    setupEventListeners() {
        // Keyboard events
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                this.jump();
            }
        });
        
        // Touch events
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.jump();
        });
        
        // Mouse events
        this.canvas.addEventListener('click', (e) => {
            e.preventDefault();
            this.jump();
        });
        
        // Prevent scrolling on touch
        document.addEventListener('touchmove', (e) => {
            e.preventDefault();
        }, { passive: false });
    }
    
    jump() {
        if (this.gameState === 'ready') {
            this.gameState = 'playing';
        }
        
        if (this.gameState === 'playing') {
            this.bird.velocity = -this.bird.jump;
            this.playSound('fly');
        } else if (this.gameState === 'gameOver') {
            this.resetGame();
        }
    }
    
    playSound(key) {
        try {
            this.sounds[key].currentTime = 0;
            this.sounds[key].play().catch(e => console.log('Audio play failed:', e));
        } catch (e) {
            console.log('Audio error:', e);
        }
    }
    
    resetGame() {
        this.bird.y = 150;
        this.bird.velocity = 0;
        this.pipes = [];
        this.score = 0;
        this.gameState = 'ready';
        
        // Add first pipe
        this.pipes.push({
            x: this.canvas.width,
            y: Math.floor(Math.random() * (this.canvas.height - this.gap - this.ground.height - 100)) - 200
        });
    }
    
    update() {
        if (this.gameState !== 'playing') return;
        
        // Update bird physics
        this.bird.velocity += this.bird.gravity;
        this.bird.y += this.bird.velocity;
        
        // Update pipes
        for (let i = this.pipes.length - 1; i >= 0; i--) {
            const pipe = this.pipes[i];
            pipe.x -= this.pipeSpeed;
            
            // Add new pipe
            if (pipe.x === this.canvas.width - 150) {
                this.pipes.push({
                    x: this.canvas.width,
                    y: Math.floor(Math.random() * (this.canvas.height - this.gap - this.ground.height - 100)) - 200
                });
            }
            
            // Remove off-screen pipes
            if (pipe.x + this.pipeWidth < 0) {
                this.pipes.splice(i, 1);
            }
            
            // Score when bird passes pipe
            if (pipe.x + this.pipeWidth < this.bird.x && !pipe.scored) {
                pipe.scored = true;
                this.score++;
                this.playSound('score');
                
                if (this.score > this.highScore) {
                    this.highScore = this.score;
                    localStorage.setItem('flappyBirdHighScore', this.highScore);
                }
            }
            
            // Collision detection
            if (this.checkCollision(pipe)) {
                this.gameState = 'gameOver';
                break;
            }
        }
        
        // Check ground collision
        if (this.bird.y + this.bird.height >= this.ground.y) {
            this.bird.y = this.ground.y - this.bird.height;
            this.gameState = 'gameOver';
        }
        
        // Check ceiling collision
        if (this.bird.y <= 0) {
            this.bird.y = 0;
            this.bird.velocity = 0;
        }
    }
    
    checkCollision(pipe) {
        const birdLeft = this.bird.x;
        const birdRight = this.bird.x + this.bird.width;
        const birdTop = this.bird.y;
        const birdBottom = this.bird.y + this.bird.height;
        
        const pipeLeft = pipe.x;
        const pipeRight = pipe.x + this.pipeWidth;
        const topPipeBottom = pipe.y + this.images.pipeNorth.height;
        const bottomPipeTop = pipe.y + this.images.pipeNorth.height + this.gap;
        
        if (birdRight > pipeLeft && birdLeft < pipeRight) {
            if (birdTop < topPipeBottom || birdBottom > bottomPipeTop) {
                return true;
            }
        }
        
        return false;
    }
    
    render() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw background
        this.ctx.drawImage(this.images.bg, 0, 0);
        
        // Draw pipes
        this.pipes.forEach(pipe => {
            // Top pipe
            this.ctx.drawImage(this.images.pipeNorth, pipe.x, pipe.y);
            // Bottom pipe
            this.ctx.drawImage(this.images.pipeSouth, pipe.x, pipe.y + this.images.pipeNorth.height + this.gap);
        });
        
        // Draw ground
        this.ctx.drawImage(this.images.fg, this.ground.x, this.ground.y);
        
        // Draw bird
        this.ctx.drawImage(this.images.bird, this.bird.x, this.bird.y);
        
        // Draw UI
        this.drawUI();
    }
    
    drawUI() {
        this.ctx.fillStyle = "#fff";
        this.ctx.strokeStyle = "#000";
        this.ctx.lineWidth = 3;
        this.ctx.font = "24px Arial";
        this.ctx.textAlign = "left";
        
        // Current score
        const scoreText = `Score: ${this.score}`;
        this.ctx.strokeText(scoreText, 10, 30);
        this.ctx.fillText(scoreText, 10, 30);
        
        // High score
        const highScoreText = `Best: ${this.highScore}`;
        this.ctx.strokeText(highScoreText, 10, 60);
        this.ctx.fillText(highScoreText, 10, 60);
        
        // Game state messages
        this.ctx.textAlign = "center";
        this.ctx.font = "20px Arial";
        
        if (this.gameState === 'loading') {
            this.ctx.strokeText("Loading...", this.canvas.width / 2, this.canvas.height / 2);
            this.ctx.fillText("Loading...", this.canvas.width / 2, this.canvas.height / 2);
        } else if (this.gameState === 'ready') {
            this.ctx.strokeText("Tap to Start!", this.canvas.width / 2, this.canvas.height / 2);
            this.ctx.fillText("Tap to Start!", this.canvas.width / 2, this.canvas.height / 2);
        } else if (this.gameState === 'gameOver') {
            this.ctx.fillStyle = "#ff0000";
            this.ctx.strokeText("Game Over!", this.canvas.width / 2, this.canvas.height / 2 - 30);
            this.ctx.fillText("Game Over!", this.canvas.width / 2, this.canvas.height / 2 - 30);
            
            this.ctx.fillStyle = "#fff";
            this.ctx.font = "16px Arial";
            this.ctx.strokeText("Tap to Restart", this.canvas.width / 2, this.canvas.height / 2 + 10);
            this.ctx.fillText("Tap to Restart", this.canvas.width / 2, this.canvas.height / 2 + 10);
        }
        
        this.ctx.textAlign = "left";
    }
    
    gameLoop() {
        this.update();
        this.render();
        requestAnimationFrame(() => this.gameLoop());
    }
}

// Start the game when the page loads
window.addEventListener('load', () => {
    new FlappyBird();
});