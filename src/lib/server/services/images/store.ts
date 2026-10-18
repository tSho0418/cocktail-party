/** Where derivative photos live (R2 in production, memory in tests). */
export interface ImageStore {
	put(key: string, data: Uint8Array, contentType: string): Promise<void>;
	delete(key: string): Promise<void>;
	publicUrl(key: string): string;
}

export function memoryImageStore(baseUrl = 'memory://images') {
	const objects = new Map<string, { data: Uint8Array; contentType: string }>();
	return {
		objects,
		async put(key, data, contentType) {
			objects.set(key, { data, contentType });
		},
		async delete(key) {
			objects.delete(key);
		},
		publicUrl: (key) => `${baseUrl}/${key}`
	} satisfies ImageStore & { objects: typeof objects };
}
