/* Snapshot-based undo/redo history (UMD). States are opaque to this class. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RS = root.RS || {};
    root.RS.History = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class History {
    constructor(initial, opts) {
      const o = opts || {};
      this.limit = o.limit || 100;
      this.equals = o.equals || null;
      this.stack = [initial];
      this.index = 0;
      this.savedIndex = 0;
    }

    get current() { return this.stack[this.index]; }
    get canUndo() { return this.index > 0; }
    get canRedo() { return this.index < this.stack.length - 1; }

    // Returns false when the state is identical to the current one (nothing recorded).
    push(state) {
      if (this.equals && this.equals(this.current, state)) return false;
      if (this.savedIndex > this.index) this.savedIndex = -1;
      this.stack.length = this.index + 1;
      this.stack.push(state);
      if (this.stack.length > this.limit) {
        this.stack.shift();
        this.savedIndex -= 1;
      }
      this.index = this.stack.length - 1;
      return true;
    }

    undo() {
      if (!this.canUndo) return null;
      this.index -= 1;
      return this.current;
    }

    redo() {
      if (!this.canRedo) return null;
      this.index += 1;
      return this.current;
    }

    markSaved() { this.savedIndex = this.index; }
    isDirty() { return this.index !== this.savedIndex; }
  }

  return History;
});
