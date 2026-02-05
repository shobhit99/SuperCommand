/**
 * Extension View
 *
 * Dynamically loads and renders a community extension's UI
 * inside the SuperCommand overlay.
 *
 * The extension code (built to CJS by esbuild) is executed with a
 * custom `require()` that provides React and our @raycast/api shim.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import * as RaycastAPI from './raycast-api';
import { NavigationContext } from './raycast-api';

// Also import @raycast/utils stubs from our shim
import * as RaycastUtils from './raycast-api';

interface ExtensionViewProps {
  code: string;
  title: string;
  onClose: () => void;
}

/**
 * Error boundary to catch runtime errors in extensions.
 */
class ExtensionErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: (err: Error) => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-white/50 p-8">
          <AlertTriangle className="w-8 h-8 text-red-400/60 mb-3" />
          <p className="text-sm text-red-400/80 font-medium mb-1">
            Extension Error
          </p>
          <p className="text-xs text-white/30 text-center max-w-sm">
            {this.state.error.message}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Execute extension code and extract the default export (React component).
 */
function loadExtensionComponent(
  code: string
): React.ComponentType<any> | null {
  try {
    const moduleExports: any = {};
    const fakeModule = { exports: moduleExports };

    // Custom require that provides our shim modules
    const fakeRequire = (name: string): any => {
      switch (name) {
        case 'react':
          return React;
        case 'react/jsx-runtime':
          return require('react/jsx-runtime');
        case '@raycast/api':
          return RaycastAPI;
        case '@raycast/utils':
          return RaycastUtils;
        default:
          // Return an empty module for unknown deps
          console.warn(
            `Extension tried to require unknown module: "${name}"`
          );
          return {};
      }
    };

    // Execute the CJS bundle in a function scope
    const fn = new Function(
      'exports',
      'require',
      'module',
      '__filename',
      '__dirname',
      code
    );

    fn(moduleExports, fakeRequire, fakeModule, '', '');

    // Get the default export
    const Component =
      fakeModule.exports.default || fakeModule.exports;

    if (typeof Component === 'function') {
      return Component;
    }

    console.error('Extension did not export a React component');
    return null;
  } catch (e) {
    console.error('Failed to load extension:', e);
    return null;
  }
}

const ExtensionView: React.FC<ExtensionViewProps> = ({
  code,
  title,
  onClose,
}) => {
  const [error, setError] = useState<string | null>(null);
  const [navStack, setNavStack] = useState<React.ReactElement[]>([]);

  // Load the extension component
  const ExtComponent = useMemo(() => loadExtensionComponent(code), [code]);

  // Navigation context
  const push = useCallback((element: React.ReactElement) => {
    setNavStack((prev) => [...prev, element]);
  }, []);

  const pop = useCallback(() => {
    setNavStack((prev) => {
      if (prev.length > 0) return prev.slice(0, -1);
      // If stack is empty, close the extension view
      onClose();
      return prev;
    });
  }, [onClose]);

  const navValue = useMemo(() => ({ push, pop }), [push, pop]);

  // Handle Escape when no navigation stack
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only handle if no input is focused (the List component handles its own Escape)
      if (
        e.key === 'Escape' &&
        navStack.length === 0 &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, navStack.length]);

  if (error) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white/70 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-white/70">{title}</span>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <AlertTriangle className="w-8 h-8 text-red-400/60 mx-auto mb-3" />
            <p className="text-sm text-red-400/80">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!ExtComponent) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white/70 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-white/70">{title}</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-white/40">
            Failed to load extension
          </p>
        </div>
      </div>
    );
  }

  // Determine what to render: top of nav stack or the root component
  const currentView =
    navStack.length > 0 ? navStack[navStack.length - 1] : null;

  return (
    <NavigationContext.Provider value={navValue}>
      <ExtensionErrorBoundary onError={(e) => setError(e.message)}>
        {currentView || <ExtComponent />}
      </ExtensionErrorBoundary>
    </NavigationContext.Provider>
  );
};

export default ExtensionView;

