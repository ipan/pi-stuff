export function getBtwTools(editingEnabled) {
	return editingEnabled ? ["read", "bash", "edit", "write"] : ["read", "bash"];
}
