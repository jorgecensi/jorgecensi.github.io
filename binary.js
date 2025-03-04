document.addEventListener("DOMContentLoaded", function () {
    const gridSize = 8;
    const grid = document.createElement("table");
    const body = document.querySelector("body");

    function generatePuzzle() {
        const puzzle = [];
        for (let i = 0; i < gridSize; i++) {
            const row = [];
            for (let j = 0; j < gridSize; j++) {
                row.push(Math.random() < 0.2 ? (Math.random() < 0.5 ? 0 : 1) : "");
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
                cell.contentEditable = puzzle[i][j] === "" ? true : false;
                cell.addEventListener("click", function () {
                    if (cell.contentEditable === "true") {
                        cell.textContent = cell.textContent === "0" ? "1" : "0";
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
