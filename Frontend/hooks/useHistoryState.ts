import { useState, useCallback } from 'react';

// A custom hook to manage state with undo/redo capabilities.
export const useHistoryState = <T>(initialState: T) => {
    // State is stored as an array of snapshots.
    const [history, setHistory] = useState<T[]>([initialState]);
    // `currentIndex` points to the current snapshot in the history array.
    const [currentIndex, setCurrentIndex] = useState(0);

    const state = history[currentIndex];

    /**
     * Updates the state and adds a new entry to the history.
     * This will clear any "redo" history.
     */
    const setState = useCallback((value: T | ((prevState: T) => T)) => {
        const newState = typeof value === 'function'
            ? (value as (prevState: T) => T)(state)
            : value;
        
        // Prevent adding to history if the state hasn't actually changed.
        // Uses simple stringify for comparison, sufficient for this app's data structures.
        if (JSON.stringify(newState) === JSON.stringify(state)) {
            return;
        }

        // Slice the history up to the current index and add the new state.
        const newHistory = history.slice(0, currentIndex + 1);
        newHistory.push(newState);
        
        setHistory(newHistory);
        setCurrentIndex(newHistory.length - 1);
    }, [history, currentIndex, state]);

    /**
     * Moves the current state back one step in the history.
     */
    const undo = useCallback(() => {
        if (currentIndex > 0) {
            setCurrentIndex(currentIndex - 1);
        }
    }, [currentIndex]);

    /**
     * Moves the current state forward one step in the history.
     */
    const redo = useCallback(() => {
        if (currentIndex < history.length - 1) {
            setCurrentIndex(currentIndex + 1);
        }
    }, [currentIndex, history.length]);

    /**
     * Resets the history to a new initial state. Used after saving.
     */
    const reset = useCallback((newState: T) => {
        setHistory([newState]);
        setCurrentIndex(0);
    }, []);

    const canUndo = currentIndex > 0;
    const canRedo = currentIndex < history.length - 1;

    return { state, setState, undo, redo, canUndo, canRedo, reset };
};
