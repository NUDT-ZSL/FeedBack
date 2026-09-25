import React from 'react';
import ErrorBoundary, { ErrorBoundaryProps } from './ErrorBoundary';

export interface WithErrorBoundaryOptions extends Omit<ErrorBoundaryProps, 'children'> {
  displayName?: string;
}

function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options: WithErrorBoundaryOptions = {}
): React.FC<P> {
  const { displayName, ...boundaryProps } = options;

  const WithErrorBoundary: React.FC<P> = (props) => {
    return (
      <ErrorBoundary {...boundaryProps}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  };

  const wrappedDisplayName = displayName || WrappedComponent.displayName || WrappedComponent.name || 'Component';
  WithErrorBoundary.displayName = `WithErrorBoundary(${wrappedDisplayName})`;

  return WithErrorBoundary;
}

export default withErrorBoundary;
