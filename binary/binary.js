const APP_VERSION = '2603220405';

document.addEventListener("DOMContentLoaded", () => {
    const gridSize = 8;
    const gridElement = document.getElementById("puzzleGrid");
    const puzzleContainer = document.getElementById("puzzleContainer");
    const statusElement = document.getElementById("binaryStatus");
    const progressBarElement = document.getElementById("binaryProgress");
    const progressFillElement = document.getElementById("binaryProgressFill");
    const progressLabelElement = document.getElementById("binaryProgressLabel");
    const celebrationElement = document.getElementById("binaryCelebration");
    const newPuzzleButton = document.getElementById("generatePuzzle");
    const resetPuzzleButton = document.getElementById("resetPuzzle");
    const toggleActionsButton = document.getElementById("toggleActions");
    const secondaryActionsElement = document.getElementById("binarySecondaryActions");
    const toggleSolutionButton = document.getElementById("toggleSolution");
    const checkPuzzleButton = document.getElementById("checkPuzzle");
    const installAppButton = document.getElementById("installBinaryApp");
    const toggleRulesButton = document.getElementById("toggleRules");
    const rulesElement = document.getElementById("rules");

    if (!gridElement || !puzzleContainer || !newPuzzleButton || !toggleSolutionButton || !toggleRulesButton || !rulesElement) {
        return;
    }

    const labels = {
        showSolution: puzzleContainer.dataset.labelShowSolution || "Show Solution",
        hideSolution: puzzleContainer.dataset.labelHideSolution || "Hide Solution",
        progressLabel: puzzleContainer.dataset.progressLabel || "{filled}/{total} editable cells filled ({percent}%).",
        statusProgress: puzzleContainer.dataset.statusProgress || "{filled}/{total} cells filled.",
        statusConflicts: puzzleContainer.dataset.statusConflicts || "{count} rule issues highlighted.",
        statusSolved: puzzleContainer.dataset.statusSolved || "Solved!",
        statusSolutionVisible: puzzleContainer.dataset.statusSolutionVisible || "Solution preview is visible.",
        statusInstallReady: puzzleContainer.dataset.statusInstallReady || "Install is available.",
        statusInstallComplete: puzzleContainer.dataset.statusInstallComplete || "App installed.",
        statusInstallCancelled: puzzleContainer.dataset.statusInstallCancelled || "Install was cancelled."
    };

    let solutionGrid = [];
    let puzzleGrid = [];
    let playerGrid = [];
    let fixedMask = [];
    let solutionVisible = false;
    let selectedCell = null;
    let conflictCells = new Set();
    let deferredInstallPrompt = null;
    let hasCelebratedSolved = false;
    let celebrationResetTimer = null;

    function createMatrix(size, value = null) {
        return Array.from({ length: size }, () => Array(size).fill(value));
    }

    function cloneGrid(source) {
        return source.map((row) => [...row]);
    }

    function shuffle(values) {
        const shuffled = [...values];
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    function keyForCell(row, col) {
        return `${row},${col}`;
    }

    function lineHasThreeAdjacent(line) {
        for (let i = 0; i <= line.length - 3; i += 1) {
            if (line[i] !== null && line[i] === line[i + 1] && line[i] === line[i + 2]) {
                return true;
            }
        }
        return false;
    }

    function lineHasExcessValues(line) {
        let zeroes = 0;
        let ones = 0;
        for (const value of line) {
            if (value === 0) {
                zeroes += 1;
            } else if (value === 1) {
                ones += 1;
            }
        }
        return zeroes > line.length / 2 || ones > line.length / 2;
    }

    function lineIsComplete(line) {
        return line.every((value) => value !== null);
    }

    function linesAreEqual(first, second) {
        for (let i = 0; i < first.length; i += 1) {
            if (first[i] !== second[i]) {
                return false;
            }
        }
        return true;
    }

    function getColumn(board, colIndex) {
        return board.map((row) => row[colIndex]);
    }

    function hasDuplicateCompletedRow(board, rowIndex) {
        const row = board[rowIndex];
        if (!lineIsComplete(row)) {
            return false;
        }
        for (let i = 0; i < board.length; i += 1) {
            if (i !== rowIndex && lineIsComplete(board[i]) && linesAreEqual(row, board[i])) {
                return true;
            }
        }
        return false;
    }

    function hasDuplicateCompletedColumn(board, colIndex) {
        const column = getColumn(board, colIndex);
        if (!lineIsComplete(column)) {
            return false;
        }
        for (let i = 0; i < board.length; i += 1) {
            if (i !== colIndex) {
                const candidate = getColumn(board, i);
                if (lineIsComplete(candidate) && linesAreEqual(column, candidate)) {
                    return true;
                }
            }
        }
        return false;
    }

    function isValidPlacement(board, row, col, value) {
        const previous = board[row][col];
        board[row][col] = value;

        const rowValues = board[row];
        const columnValues = getColumn(board, col);

        const valid = !lineHasThreeAdjacent(rowValues)
            && !lineHasThreeAdjacent(columnValues)
            && !lineHasExcessValues(rowValues)
            && !lineHasExcessValues(columnValues)
            && !hasDuplicateCompletedRow(board, row)
            && !hasDuplicateCompletedColumn(board, col);

        board[row][col] = previous;
        return valid;
    }

    function fillCompletedGrid(board, index = 0) {
        if (index === gridSize * gridSize) {
            return true;
        }

        const row = Math.floor(index / gridSize);
        const col = index % gridSize;

        if (board[row][col] !== null) {
            return fillCompletedGrid(board, index + 1);
        }

        for (const value of shuffle([0, 1])) {
            if (isValidPlacement(board, row, col, value)) {
                board[row][col] = value;
                if (fillCompletedGrid(board, index + 1)) {
                    return true;
                }
                board[row][col] = null;
            }
        }

        return false;
    }

    function generateCompletedGrid() {
        const board = createMatrix(gridSize);
        if (!fillCompletedGrid(board)) {
            throw new Error("Unable to generate a valid binary puzzle grid.");
        }
        return board;
    }

    function findMostConstrainedCell(board) {
        let best = null;

        for (let row = 0; row < gridSize; row += 1) {
            for (let col = 0; col < gridSize; col += 1) {
                if (board[row][col] !== null) {
                    continue;
                }

                const candidates = [0, 1].filter((value) => isValidPlacement(board, row, col, value));

                if (candidates.length === 0) {
                    return { row, col, candidates };
                }

                if (!best || candidates.length < best.candidates.length) {
                    best = { row, col, candidates };
                    if (best.candidates.length === 1) {
                        return best;
                    }
                }
            }
        }

        return best;
    }

    function countSolutions(board, limit = 2) {
        if (limit <= 0) {
            return 0;
        }

        const next = findMostConstrainedCell(board);
        if (!next) {
            return 1;
        }
        if (next.candidates.length === 0) {
            return 0;
        }

        let total = 0;
        for (const candidate of next.candidates) {
            board[next.row][next.col] = candidate;
            total += countSolutions(board, limit - total);
            board[next.row][next.col] = null;
            if (total >= limit) {
                return total;
            }
        }
        return total;
    }

    function generatePuzzleFromSolution(solution) {
        const puzzle = cloneGrid(solution);
        const positions = shuffle(Array.from({ length: gridSize * gridSize }, (_, index) => index));
        const minimumClues = Math.ceil(gridSize * gridSize * 0.42);
        let cluesLeft = gridSize * gridSize;

        for (const position of positions) {
            if (cluesLeft <= minimumClues) {
                break;
            }

            const row = Math.floor(position / gridSize);
            const col = position % gridSize;
            const backup = puzzle[row][col];
            puzzle[row][col] = null;

            const testBoard = cloneGrid(puzzle);
            if (countSolutions(testBoard, 2) !== 1) {
                puzzle[row][col] = backup;
                continue;
            }

            cluesLeft -= 1;
        }

        return puzzle;
    }

    function replaceTokens(template, values) {
        return template.replace(/\{(\w+)\}/g, (fullMatch, token) => {
            if (Object.prototype.hasOwnProperty.call(values, token)) {
                return values[token];
            }
            return fullMatch;
        });
    }

    function collectValidation(board) {
        const conflicts = new Set();

        for (let row = 0; row < gridSize; row += 1) {
            const line = board[row];

            for (let col = 0; col <= gridSize - 3; col += 1) {
                if (line[col] !== null && line[col] === line[col + 1] && line[col] === line[col + 2]) {
                    conflicts.add(keyForCell(row, col));
                    conflicts.add(keyForCell(row, col + 1));
                    conflicts.add(keyForCell(row, col + 2));
                }
            }

            let zeroes = 0;
            let ones = 0;
            for (let col = 0; col < gridSize; col += 1) {
                if (line[col] === 0) {
                    zeroes += 1;
                } else if (line[col] === 1) {
                    ones += 1;
                }
            }
            if (zeroes > gridSize / 2 || ones > gridSize / 2) {
                for (let col = 0; col < gridSize; col += 1) {
                    if (line[col] !== null) {
                        conflicts.add(keyForCell(row, col));
                    }
                }
            }
        }

        for (let col = 0; col < gridSize; col += 1) {
            const line = getColumn(board, col);

            for (let row = 0; row <= gridSize - 3; row += 1) {
                if (line[row] !== null && line[row] === line[row + 1] && line[row] === line[row + 2]) {
                    conflicts.add(keyForCell(row, col));
                    conflicts.add(keyForCell(row + 1, col));
                    conflicts.add(keyForCell(row + 2, col));
                }
            }

            let zeroes = 0;
            let ones = 0;
            for (let row = 0; row < gridSize; row += 1) {
                if (line[row] === 0) {
                    zeroes += 1;
                } else if (line[row] === 1) {
                    ones += 1;
                }
            }
            if (zeroes > gridSize / 2 || ones > gridSize / 2) {
                for (let row = 0; row < gridSize; row += 1) {
                    if (line[row] !== null) {
                        conflicts.add(keyForCell(row, col));
                    }
                }
            }
        }

        const completedRows = [];
        for (let row = 0; row < gridSize; row += 1) {
            if (lineIsComplete(board[row])) {
                completedRows.push(row);
            }
        }
        for (let i = 0; i < completedRows.length; i += 1) {
            for (let j = i + 1; j < completedRows.length; j += 1) {
                const first = completedRows[i];
                const second = completedRows[j];
                if (linesAreEqual(board[first], board[second])) {
                    for (let col = 0; col < gridSize; col += 1) {
                        conflicts.add(keyForCell(first, col));
                        conflicts.add(keyForCell(second, col));
                    }
                }
            }
        }

        const completedColumns = [];
        for (let col = 0; col < gridSize; col += 1) {
            const column = getColumn(board, col);
            if (lineIsComplete(column)) {
                completedColumns.push(col);
            }
        }
        for (let i = 0; i < completedColumns.length; i += 1) {
            for (let j = i + 1; j < completedColumns.length; j += 1) {
                const first = completedColumns[i];
                const second = completedColumns[j];
                if (linesAreEqual(getColumn(board, first), getColumn(board, second))) {
                    for (let row = 0; row < gridSize; row += 1) {
                        conflicts.add(keyForCell(row, first));
                        conflicts.add(keyForCell(row, second));
                    }
                }
            }
        }

        let filled = 0;
        for (let row = 0; row < gridSize; row += 1) {
            for (let col = 0; col < gridSize; col += 1) {
                if (!fixedMask[row][col] && board[row][col] !== null) {
                    filled += 1;
                }
            }
        }

        const totalEditable = gridSize * gridSize - fixedMask.flat().filter(Boolean).length;
        const solved = conflicts.size === 0
            && board.every((row) => row.every((cell) => cell !== null))
            && board.every((row, rowIndex) => row.every((cell, colIndex) => cell === solutionGrid[rowIndex][colIndex]));

        return { conflicts, filled, totalEditable, solved };
    }

    function buildGridTable() {
        gridElement.innerHTML = "";
        for (let row = 0; row < gridSize; row += 1) {
            const rowElement = document.createElement("tr");
            for (let col = 0; col < gridSize; col += 1) {
                const cellElement = document.createElement("td");
                cellElement.dataset.row = String(row);
                cellElement.dataset.col = String(col);
                cellElement.setAttribute("role", "button");
                rowElement.appendChild(cellElement);
            }
            gridElement.appendChild(rowElement);
        }
    }

    function getCellElement(row, col) {
        return gridElement.querySelector(`td[data-row="${row}"][data-col="${col}"]`);
    }

    function updateSingleCell(row, col) {
        const cellElement = getCellElement(row, col);
        if (!cellElement) {
            return;
        }

        const value = solutionVisible ? solutionGrid[row][col] : playerGrid[row][col];
        cellElement.textContent = value === null ? "" : String(value);

        const isFixed = fixedMask[row][col];
        cellElement.classList.toggle("fixed-cell", isFixed);
        cellElement.classList.toggle("editable-cell", !isFixed);
        cellElement.classList.toggle("solution-cell", solutionVisible && !isFixed);
        cellElement.classList.toggle("user-cell", !isFixed && !solutionVisible && playerGrid[row][col] !== null);
        cellElement.classList.toggle("conflict-cell", !solutionVisible && conflictCells.has(keyForCell(row, col)));
        cellElement.classList.toggle("selected-cell", !!selectedCell && selectedCell.row === row && selectedCell.col === col);
        cellElement.classList.toggle("related-row", !!selectedCell && selectedCell.row === row && selectedCell.col !== col);
        cellElement.classList.toggle("related-col", !!selectedCell && selectedCell.col === col && selectedCell.row !== row);
        cellElement.tabIndex = isFixed ? -1 : 0;
        const ariaValue = value === null ? "empty" : String(value);
        const ariaType = isFixed ? "fixed clue" : "editable";
        cellElement.setAttribute("aria-label", `Row ${row + 1}, Column ${col + 1}, ${ariaType}, value ${ariaValue}`);
    }

    function renderGrid() {
        for (let row = 0; row < gridSize; row += 1) {
            for (let col = 0; col < gridSize; col += 1) {
                updateSingleCell(row, col);
            }
        }
    }

    function setStatus(text) {
        if (statusElement) {
            statusElement.textContent = text;
        }
    }

    function isCompactControls() {
        return window.matchMedia("(max-width: 768px)").matches;
    }

    function setSecondaryActionsOpen(isOpen) {
        if (!secondaryActionsElement || !toggleActionsButton) {
            return;
        }
        const open = isOpen && isCompactControls();
        secondaryActionsElement.classList.toggle("is-open", open);
        toggleActionsButton.setAttribute("aria-expanded", String(open));
    }

    function closeSecondaryActions() {
        setSecondaryActionsOpen(false);
    }

    function resetCelebrationState() {
        hasCelebratedSolved = false;
        if (celebrationResetTimer) {
            window.clearTimeout(celebrationResetTimer);
            celebrationResetTimer = null;
        }
        puzzleContainer.classList.remove("solved-celebration");
        if (celebrationElement) {
            celebrationElement.classList.remove("is-visible");
            celebrationElement.setAttribute("aria-hidden", "true");
        }
        if (statusElement) {
            statusElement.classList.remove("status-solved");
        }
    }

    function triggerSolvedCelebration() {
        if (celebrationResetTimer) {
            window.clearTimeout(celebrationResetTimer);
        }

        puzzleContainer.classList.remove("solved-celebration");
        void puzzleContainer.offsetWidth;
        puzzleContainer.classList.add("solved-celebration");
        if (celebrationElement) {
            celebrationElement.classList.remove("is-visible");
            void celebrationElement.offsetWidth;
            celebrationElement.classList.add("is-visible");
            celebrationElement.setAttribute("aria-hidden", "false");
        }
        celebrationResetTimer = window.setTimeout(() => {
            puzzleContainer.classList.remove("solved-celebration");
            if (celebrationElement) {
                celebrationElement.classList.remove("is-visible");
                celebrationElement.setAttribute("aria-hidden", "true");
            }
            celebrationResetTimer = null;
        }, 4000);

        if (typeof navigator.vibrate === "function") {
            navigator.vibrate([80, 40, 120]);
        }
    }

    function updateProgress(filled, total) {
        if (!progressBarElement || !progressFillElement || !progressLabelElement) {
            return;
        }

        const percent = total <= 0 ? 100 : Math.round((filled / total) * 100);
        progressFillElement.style.width = `${percent}%`;
        progressBarElement.setAttribute("aria-valuenow", String(percent));
        progressLabelElement.textContent = replaceTokens(labels.progressLabel, {
            filled: String(filled),
            total: String(total),
            percent: String(percent)
        });
    }

    function registerServiceWorker() {
        if (!("serviceWorker" in navigator)) {
            return;
        }

        const isPortugueseRoute = window.location.pathname.startsWith("/pt-BR/binary/");
        const serviceWorkerUrl = isPortugueseRoute ? "/pt-BR/binary/sw.js" : "/binary/sw.js";
        const scope = isPortugueseRoute ? "/pt-BR/binary/" : "/binary/";

        function showUpdateBanner(registration) {
            if (document.getElementById("sw-update-banner")) {
                return;
            }
            const banner = document.createElement("div");
            banner.id = "sw-update-banner";
            banner.style.cssText = [
                "position:fixed", "bottom:0", "left:0", "right:0",
                "background:#1e1d3a", "color:#e2e8f0", "padding:12px 16px",
                "display:flex", "align-items:center", "justify-content:space-between",
                "z-index:9999", "font-family:inherit", "font-size:14px",
                "border-top:1px solid #6366f1"
            ].join(";");
            banner.innerHTML = [
                "<span>A new version is available.</span>",
                "<button style=\"background:#6366f1;color:#fff;border:none;padding:6px 14px;",
                "border-radius:4px;cursor:pointer;font-size:14px\">Refresh</button>"
            ].join("");
            banner.querySelector("button").addEventListener("click", () => {
                if (registration.waiting) {
                    registration.waiting.postMessage({ type: "SKIP_WAITING" });
                }
            });
            document.body.appendChild(banner);
        }

        let hasRefreshedForUpdate = false;

        window.addEventListener("load", () => {
            navigator.serviceWorker.register(serviceWorkerUrl, { scope }).then((registration) => {
                if (registration.waiting) {
                    showUpdateBanner(registration);
                }

                registration.addEventListener("updatefound", () => {
                    const newWorker = registration.installing;
                    if (!newWorker) return;
                    newWorker.addEventListener("statechange", () => {
                        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                            showUpdateBanner(registration);
                        }
                    });
                });

                navigator.serviceWorker.addEventListener("controllerchange", () => {
                    if (hasRefreshedForUpdate) return;
                    hasRefreshedForUpdate = true;
                    window.location.reload();
                });

                window.addEventListener("focus", () => registration.update());
                setInterval(() => registration.update(), 60 * 60 * 1000);
            }).catch(() => {
                // Keep gameplay functional if service worker registration fails.
            });
        });
    }

    function updateStatus() {
        const result = collectValidation(playerGrid);
        conflictCells = result.conflicts;
        renderGrid();
        updateProgress(result.filled, result.totalEditable);
        if (statusElement) {
            statusElement.classList.toggle("status-solved", result.solved);
        }

        if (result.solved && !hasCelebratedSolved) {
            triggerSolvedCelebration();
            hasCelebratedSolved = true;
        } else if (!result.solved) {
            hasCelebratedSolved = false;
            puzzleContainer.classList.remove("solved-celebration");
        }

        if (solutionVisible) {
            setStatus(labels.statusSolutionVisible);
            return;
        }

        if (result.solved) {
            setStatus(labels.statusSolved);
            return;
        }

        if (result.conflicts.size > 0) {
            setStatus(replaceTokens(labels.statusConflicts, { count: String(result.conflicts.size) }));
            return;
        }

        setStatus(replaceTokens(labels.statusProgress, {
            filled: String(result.filled),
            total: String(result.totalEditable)
        }));
    }

    function cyclePlayerCell(row, col) {
        if (fixedMask[row][col] || solutionVisible) {
            return;
        }

        const current = playerGrid[row][col];
        if (current === null) {
            playerGrid[row][col] = 0;
        } else if (current === 0) {
            playerGrid[row][col] = 1;
        } else {
            playerGrid[row][col] = null;
        }
        updateStatus();
    }

    function selectCell(row, col) {
        selectedCell = { row, col };
        renderGrid();
    }

    function toggleSolution() {
        solutionVisible = !solutionVisible;
        toggleSolutionButton.textContent = solutionVisible ? labels.hideSolution : labels.showSolution;
        renderGrid();
        updateStatus();
    }

    function toggleRules() {
        const willShow = rulesElement.hasAttribute("hidden");
        if (willShow) {
            rulesElement.removeAttribute("hidden");
            rulesElement.classList.add("visible");
        } else {
            rulesElement.setAttribute("hidden", "");
            rulesElement.classList.remove("visible");
        }
        toggleRulesButton.setAttribute("aria-expanded", String(willShow));
    }

    function resetCurrentPuzzle() {
        solutionVisible = false;
        selectedCell = null;
        closeSecondaryActions();
        resetCelebrationState();
        toggleSolutionButton.textContent = labels.showSolution;
        playerGrid = cloneGrid(puzzleGrid);
        conflictCells = new Set();
        updateStatus();
    }

    function setupInstallPrompt() {
        if (!installAppButton) {
            return;
        }

        window.addEventListener("beforeinstallprompt", (event) => {
            event.preventDefault();
            deferredInstallPrompt = event;
            installAppButton.hidden = false;
            setStatus(labels.statusInstallReady);
        });

        installAppButton.addEventListener("click", async () => {
            closeSecondaryActions();
            if (!deferredInstallPrompt) {
                return;
            }

            deferredInstallPrompt.prompt();
            const { outcome } = await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;
            installAppButton.hidden = true;

            if (outcome === "accepted") {
                setStatus(labels.statusInstallComplete);
            } else {
                setStatus(labels.statusInstallCancelled);
            }
        });

        window.addEventListener("appinstalled", () => {
            deferredInstallPrompt = null;
            installAppButton.hidden = true;
            setStatus(labels.statusInstallComplete);
        });
    }

    function startNewPuzzle() {
        solutionVisible = false;
        selectedCell = null;
        closeSecondaryActions();
        resetCelebrationState();
        toggleSolutionButton.textContent = labels.showSolution;

        solutionGrid = generateCompletedGrid();
        puzzleGrid = generatePuzzleFromSolution(solutionGrid);
        playerGrid = cloneGrid(puzzleGrid);
        fixedMask = puzzleGrid.map((row) => row.map((cell) => cell !== null));
        conflictCells = new Set();

        buildGridTable();
        updateStatus();
    }

    gridElement.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLTableCellElement)) {
            return;
        }

        const row = Number(target.dataset.row);
        const col = Number(target.dataset.col);
        selectCell(row, col);
        cyclePlayerCell(row, col);
    });

    gridElement.addEventListener("keydown", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLTableCellElement)) {
            return;
        }

        const row = Number(target.dataset.row);
        const col = Number(target.dataset.col);
        if (!Number.isInteger(row) || !Number.isInteger(col)) {
            return;
        }

        const key = event.key;
        if (key === "Enter" || key === " ") {
            event.preventDefault();
            cyclePlayerCell(row, col);
            return;
        }

        if (key === "Backspace" || key === "Delete" || key === "0" || key === "1") {
            event.preventDefault();
            if (fixedMask[row][col] || solutionVisible) {
                return;
            }
            if (key === "Backspace" || key === "Delete") {
                playerGrid[row][col] = null;
            } else {
                playerGrid[row][col] = Number(key);
            }
            updateStatus();
            return;
        }

        const movement = {
            ArrowUp: { row: -1, col: 0 },
            ArrowDown: { row: 1, col: 0 },
            ArrowLeft: { row: 0, col: -1 },
            ArrowRight: { row: 0, col: 1 }
        }[key];

        if (movement) {
            event.preventDefault();
            const nextRow = (row + movement.row + gridSize) % gridSize;
            const nextCol = (col + movement.col + gridSize) % gridSize;
            selectCell(nextRow, nextCol);
            const nextCell = getCellElement(nextRow, nextCol);
            if (nextCell) {
                nextCell.focus();
            }
        }
    });

    newPuzzleButton.addEventListener("click", () => {
        startNewPuzzle();
    });

    if (resetPuzzleButton) {
        resetPuzzleButton.addEventListener("click", () => {
            resetCurrentPuzzle();
        });
    }

    toggleSolutionButton.addEventListener("click", () => {
        toggleSolution();
        closeSecondaryActions();
    });

    if (checkPuzzleButton) {
        checkPuzzleButton.addEventListener("click", () => {
            updateStatus();
            closeSecondaryActions();
        });
    }

    toggleRulesButton.addEventListener("click", () => {
        toggleRules();
        closeSecondaryActions();
    });

    if (toggleActionsButton && secondaryActionsElement) {
        toggleActionsButton.addEventListener("click", (event) => {
            event.preventDefault();
            const willOpen = !secondaryActionsElement.classList.contains("is-open");
            setSecondaryActionsOpen(willOpen);
        });

        document.addEventListener("click", (event) => {
            if (!isCompactControls()) {
                return;
            }
            const target = event.target;
            if (!(target instanceof Node)) {
                return;
            }
            if (secondaryActionsElement.contains(target) || toggleActionsButton.contains(target)) {
                return;
            }
            closeSecondaryActions();
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeSecondaryActions();
            }
        });

        window.addEventListener("resize", () => {
            if (!isCompactControls()) {
                closeSecondaryActions();
            }
        });
    }

    if (rulesElement && !rulesElement.hasAttribute("hidden")) {
        rulesElement.setAttribute("hidden", "");
    }
    toggleRulesButton.setAttribute("aria-expanded", "false");
    if (toggleActionsButton) {
        toggleActionsButton.setAttribute("aria-expanded", "false");
    }
    setupInstallPrompt();
    registerServiceWorker();
    startNewPuzzle();

    const versionEl = document.getElementById("binary-app-version");
    if (versionEl) versionEl.textContent = "v" + APP_VERSION;
});
