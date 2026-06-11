import { createContext, useContext, useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

export type PermKey =
  | 'page_planning' | 'page_commandes' | 'page_ca' | 'page_settings' | 'page_annonces' | 'page_conges'
  | 'action_create_commande' | 'action_update_statut_commande' | 'action_delete_commande'
  | 'action_derogation_temp' | 'action_delete_lot' | 'action_delete_livraison' | 'action_delete_ac'
  | 'field_prix_estime' | 'field_notes_cuisine' | 'field_notes_manager' | 'field_createur_lot'

export type RolePerms = Record<PermKey, boolean>
export type AppPermissions = { manager: RolePerms; corner: RolePerms; cuisine: RolePerms }

export const DEFAULT_PERMISSIONS: AppPermissions = {
  manager: {
    page_planning: true, page_commandes: true, page_ca: true, page_settings: true, page_annonces: true, page_conges: true,
    action_create_commande: true, action_update_statut_commande: true, action_delete_commande: true,
    action_derogation_temp: true, action_delete_lot: true, action_delete_livraison: true, action_delete_ac: true,
    field_prix_estime: true, field_notes_cuisine: true, field_notes_manager: true, field_createur_lot: true,
  },
  corner: {
    page_planning: true, page_commandes: true, page_ca: false, page_settings: false, page_annonces: false, page_conges: false,
    action_create_commande: true, action_update_statut_commande: false, action_delete_commande: false,
    action_derogation_temp: false, action_delete_lot: false, action_delete_livraison: false, action_delete_ac: false,
    field_prix_estime: false, field_notes_cuisine: true, field_notes_manager: false, field_createur_lot: false,
  },
  cuisine: {
    page_planning: false, page_commandes: true, page_ca: false, page_settings: false, page_annonces: false, page_conges: false,
    action_create_commande: false, action_update_statut_commande: false, action_delete_commande: false,
    action_derogation_temp: false, action_delete_lot: true, action_delete_livraison: true, action_delete_ac: false,
    field_prix_estime: false, field_notes_cuisine: true, field_notes_manager: false, field_createur_lot: false,
  },
}

export function mergeWithDefaults(data: any): AppPermissions {
  const result = { ...DEFAULT_PERMISSIONS }
  for (const role of ['manager', 'corner', 'cuisine'] as const) {
    if (data[role]) result[role] = { ...DEFAULT_PERMISSIONS[role], ...data[role] }
  }
  return result
}

interface PermissionsContextValue {
  permissions: AppPermissions
  can: (role: string | undefined, key: PermKey) => boolean
}

const PermissionsContext = createContext<PermissionsContextValue>({
  permissions: DEFAULT_PERMISSIONS,
  can: (role, key) => {
    if (!role || role === 'patron' || role === 'administrateur') return true
    return DEFAULT_PERMISSIONS[role as keyof AppPermissions]?.[key] ?? false
  },
})

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const [permissions, setPermissions] = useState<AppPermissions>(DEFAULT_PERMISSIONS)

  useEffect(() => {
    getDoc(doc(db, 'settings', 'permissions')).then(snap => {
      if (snap.exists()) setPermissions(mergeWithDefaults(snap.data()))
    })
  }, [])

  function can(role: string | undefined, key: PermKey): boolean {
    if (!role || role === 'patron' || role === 'administrateur') return true
    const rolePerms = permissions[role as keyof AppPermissions]
    return rolePerms?.[key] ?? false
  }

  return (
    <PermissionsContext.Provider value={{ permissions, can }}>
      {children}
    </PermissionsContext.Provider>
  )
}

export function usePermissions() {
  return useContext(PermissionsContext)
}
