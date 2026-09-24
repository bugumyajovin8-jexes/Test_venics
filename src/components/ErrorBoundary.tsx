/**
 * The app-wide crash screen, and the boundary that shows it.
 *
 * WHY THIS LIVES IN ITS OWN FILE
 *
 * The boundary used to be declared inside App.tsx and used inside the tree App
 * returns — which means it could catch a page, but never App itself. A React
 * error boundary only catches its DESCENDANTS, so an error thrown while App was
 * rendering had nothing above it to stop at: React tore down the whole root,
 * #root went empty, and what showed through was the bare `body` background from
 * index.html — a flat dark blue screen with nothing on it and no way back
 * except force-quitting the app.
 *
 * That is exactly what a hook-order mistake in App did on every login and
 * logout. Moving the class out here lets main.tsx wrap <App /> from OUTSIDE, so
 * the same class of failure now lands on a screen with a button on it.
 *
 * The inner boundary in App.tsx stays. It is the closer one, so a page crash
 * still stops there and the rest of App keeps running; this one is the net
 * underneath it.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Deliberately plain: no store, no router, no hooks, no imported components.
 * This renders *after* something has already gone wrong, so every dependency it
 * takes on is another thing that can throw while it tries to apologise — and an
 * error thrown inside a boundary's fallback is not caught by that boundary.
 */
export function AppCrashScreen({ error }: { error?: any }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-red-50 text-center">
      <AlertTriangle className="w-16 h-16 text-red-600 mb-4" />
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Kuna tatizo limetokea</h1>
      <p className="text-gray-600 mb-6 max-w-md">Programu imeshindwa kuendelea. Tafadhali jaribu kupakia upya ukurasa.</p>
      <button
        onClick={() => window.location.reload()}
        className="bg-red-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg"
      >
        Pakia Upya
      </button>
      {process.env.NODE_ENV === 'development' && (
        <pre className="mt-8 p-4 bg-white border border-red-100 rounded-xl text-left text-xs overflow-auto max-w-full">
          {error?.toString()}
        </pre>
      )}
    </div>
  );
}

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: any }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('App Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) return <AppCrashScreen error={this.state.error} />;
    return this.props.children;
  }
}
