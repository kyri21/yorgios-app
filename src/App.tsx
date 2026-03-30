import { BrowserRouter } from 'react-router-dom';
import { FirebaseProvider } from './firebase/context';
import AppRouter from './router';

export default function App() {
  return (
    <FirebaseProvider>
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </FirebaseProvider>
  );
}
