/** Resolve only after React Router commits the target URL to browser history. */
export function softNavigate(
  navigate: (path: string) => void,
  path: string,
): Promise<void> {
  const transitionDocument = document as unknown as {
    startViewTransition?: (callback: () => void) => unknown;
  };
  return new Promise((resolve) => {
    const commit = () => {
      navigate(path);
      resolve();
    };
    if (transitionDocument.startViewTransition) {
      transitionDocument.startViewTransition(commit);
    } else {
      commit();
    }
  });
}
