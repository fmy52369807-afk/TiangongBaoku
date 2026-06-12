/**
 * localStorage wrapper for favorites management
 * Uses SOURCE_DATA from data.js
 */
const FavoritesStore = {
    _key: 'yuedu_favorites',

    /** Get all favorited source IDs */
    getAll() {
        try {
            const raw = localStorage.getItem(this._key);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    },

    /** Check if a source is favorited */
    has(id) {
        return this.getAll().includes(id);
    },

    /** Add a source to favorites */
    add(id) {
        const list = this.getAll();
        if (!list.includes(id)) {
            list.push(id);
            this._save(list);
        }
    },

    /** Remove a source from favorites */
    remove(id) {
        const list = this.getAll().filter(x => x !== id);
        this._save(list);
    },

    /** Toggle favorite status. Returns new state (true = now favorited) */
    toggle(id) {
        if (this.has(id)) {
            this.remove(id);
            return false;
        } else {
            this.add(id);
            return true;
        }
    },

    /** Get count of favorites */
    count() {
        return this.getAll().length;
    },

    /** Get full source objects for all favorites (from index metadata) */
    getSources() {
        const ids = this.getAll();
        if (!window.SOURCE_DATA || !window.SOURCE_DATA.index) return [];
        const idx = window.SOURCE_DATA.index;
        return ids
            .map(id => {
                const entry = idx.find(e => e.id === id);
                return entry || null;
            })
            .filter(Boolean);
    },

    /** Internal save */
    _save(list) {
        try {
            localStorage.setItem(this._key, JSON.stringify(list));
        } catch (e) {
            console.warn('Failed to save favorites:', e);
        }
    },
};
