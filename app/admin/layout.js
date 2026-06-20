import { getSession } from '../../lib/session';
import AppShell from '../components/AppShell';

export default async function AdminLayout({ children }) {
  const user = await getSession();
  return <AppShell user={user}>{children}</AppShell>;
}
