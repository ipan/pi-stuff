export function createRecentFiles() {
	return [];
}

export function recordChangedFile(recentFiles, filePath) {
	const normalized = filePath.trim();
	if (!normalized) {
		return;
	}

	const existingIndex = recentFiles.indexOf(normalized);
	if (existingIndex !== -1) {
		recentFiles.splice(existingIndex, 1);
	}
	recentFiles.unshift(normalized);
}
