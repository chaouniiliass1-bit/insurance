import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

export function navigate(name: string, params?: any) {
  try {
    if (navigationRef.isReady()) {
      // @ts-ignore
      navigationRef.navigate(name as never, params as never);
      return true;
    }
  } catch {}
  return false;
}

export function resetTo(name: string, params?: any) {
  try {
    if (navigationRef.isReady()) {
      navigationRef.reset({ index: 0, routes: [{ name, params }] });
      return true;
    }
  } catch {}
  return false;
}

export function goBack() {
  try {
    if (navigationRef.isReady()) {
      if (navigationRef.canGoBack()) {
        navigationRef.goBack();
        return true;
      }
      // Fallback: when no back stack exists, return to main flow
      // @ts-ignore
      navigationRef.navigate('MoodSelection');
      return true;
    }
  } catch {}
  return false;
}