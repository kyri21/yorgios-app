import { BrowserRouter } from 'react-router-dom';
import { FirebaseProvider } from './firebase/context';
import { PermissionsProvider } from './contexts/PermissionsContext';
import AppRouter from './router';

export default function App() {
  return (
    <FirebaseProvider>
      <PermissionsProvider>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </PermissionsProvider>
    </FirebaseProvider>
  );
}
