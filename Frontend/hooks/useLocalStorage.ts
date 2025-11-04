import { useState } from 'react';

// This custom hook provides a state variable that is persisted to localStorage.
function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
    // 1. Initialize state from localStorage on component mount.
    const [storedValue, setStoredValue] = useState<T>(() => {
        // This function is only executed on the initial render.
        if (typeof window === 'undefined') {
            return initialValue;
        }
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.error(`Error reading localStorage key “${key}”:`, error);
            return initialValue;
        }
    });

    // 2. Create a new `setValue` function that wraps `setStoredValue`.
    const setValue = (value: T | ((val: T) => T)) => {
        // This function will be returned by the hook for the component to use.
        setStoredValue(currentValue => {
            try {
                // Allow value to be a function so we have the same API as useState.
                const valueToStore = value instanceof Function ? value(currentValue) : value;

                // Save the new value to localStorage.
                if (typeof window !== 'undefined') {
                    window.localStorage.setItem(key, JSON.stringify(valueToStore));
                }
                
                // Return the new value to update the state.
                return valueToStore;
            } catch (error) {
                console.error(`Error setting localStorage key “${key}”:`, error);
                // If an error occurs, we return the current value to avoid crashing.
                return currentValue;
            }
        });
    };

    return [storedValue, setValue];
}

export default useLocalStorage;
