document.addEventListener("DOMContentLoaded", function () {
    const gridSize = 8;
    const grid = document.createElement("table");
    const body = document.querySelector("body");

    function generatePuzzle() {
        const puzzle = [];
        for (let i = 0; i < gridSize; i++) {
            const row = [];
            for (let j = 0; j < gridSize; j++) {
                row.push(Math.random() < 0.5 ? 0 : 1);
            }
            puzzle.push(row);
        }
        return puzzle;
    }

    function renderPuzzle(puzzle) {
        grid.innerHTML = "";
        for (let i = 0; i < gridSize; i++) {
            const row = document.createElement("tr");
            for (let j = 0; j < gridSize; j++) {
                const cell = document.createElement("td");
                cell.textContent = puzzle[i][j];
                cell.contentEditable = true;
                cell.addEventListener("input", function () {
                    if (cell.textContent !== "0" && cell.textContent !== "1") {
                        cell.textContent = puzzle[i][j];
                    }
                });
                row.appendChild(cell);
            }
            grid.appendChild(row);
        }
    }

    const puzzle = generatePuzzle();
    renderPuzzle(puzzle);
    body.appendChild(grid);
});
