document.addEventListener("DOMContentLoaded", function () {
    const gridSize = 8;
    const grid = document.createElement("table");
    const body = document.querySelector("body");

    function generateCompletedGrid(size) {
        const grid = Array(size).fill().map(() => Array(size).fill(null));
        if (solveGrid(grid, 0, 0, size)) {
            return grid;
        }
        return null;
    }

    function solveGrid(grid, row, col, size) {
        if (row === size) {
            return true;
        }
        let nextRow = row;
        let nextCol = col + 1;
        if (nextCol === size) {
            nextRow++;
            nextCol = 0;
        }
        for (const value of shuffleArray([0, 1])) {
            if (isValidPlacement(grid, row, col, value, size)) {
                grid[row][col] = value;
                if (solveGrid(grid, nextRow, nextCol, size)) {
                    return true;
                }
                grid[row][col] = null;
            }
        }
        return false;
    }

    function shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    function isValidPlacement(grid, row, col, value, size) {
        if (col >= 2 && grid[row][col - 1] === value && grid[row][col - 2] === value) {
            return false;
        }
        if (row >= 2 && grid[row - 1][col] === value && grid[row - 2][col] === value) {
            return false;
        }
        let rowCount = 0, colCount = 0;
        let rowFilled = true, colFilled = true;
        for (let i = 0; i < size; i++) {
            if (grid[row][i] === value) rowCount++;
            if (grid[row][i] === null) rowFilled = false;
            if (grid[i][col] === value) colCount++;
            if (grid[i][col] === null) colFilled = false;
        }
        if (rowFilled && rowCount >= size / 2) return false;
        if (colFilled && colCount >= size / 2) return false;
        if (colFilled || rowFilled) {
            // Implementation of uniqueness check here...
        }
        return true;
    }

    function generatePuzzle() {
        const completedGrid = generateCompletedGrid(gridSize);
        const puzzle = completedGrid.map(row => row.map(cell => (Math.random() < 0.2 ? cell : "")));
        return puzzle;
    }

    function renderPuzzle(puzzle) {
        grid.innerHTML = "";
        for (let i = 0; i < gridSize; i++) {
            const row = document.createElement("tr");
            for (let j = 0; j < gridSize; j++) {
                const cell = document.createElement("td");
                cell.textContent = puzzle[i][j];
                cell.contentEditable = false;
                cell.addEventListener("click", function () {
                    if (cell.textContent === "") {
                        cell.textContent = "0";
                    } else if (cell.textContent === "0") {
                        cell.textContent = "1";
                    } else {
                        cell.textContent = "";
                    }
                });
                row.appendChild(cell);
            }
            grid.appendChild(row);
        }
    }

    function validatePuzzle() {
        const rows = grid.querySelectorAll("tr");
        for (let i = 0; i < gridSize; i++) {
            const row = rows[i];
            const cells = row.querySelectorAll("td");
            const rowValues = [];
            for (let j = 0; j < gridSize; j++) {
                rowValues.push(cells[j].textContent);
            }
            if (!isValidRow(rowValues)) {
                alert("Invalid row: " + (i + 1));
                return false;
            }
        }
        alert("Puzzle is valid!");
        return true;
    }

    function isValidRow(row) {
        const counts = { "0": 0, "1": 0 };
        for (let i = 0; i < row.length; i++) {
            counts[row[i]]++;
            if (counts[row[i]] > gridSize / 2) {
                return false;
            }
        }
        return true;
    }

    document.getElementById("generatePuzzle").addEventListener("click", function () {
        const puzzle = generatePuzzle();
        renderPuzzle(puzzle);
    });

    document.getElementById("validatePuzzle").addEventListener("click", function () {
        validatePuzzle();
    });

    const puzzle = generatePuzzle();
    renderPuzzle(puzzle);
    body.appendChild(grid);
});
