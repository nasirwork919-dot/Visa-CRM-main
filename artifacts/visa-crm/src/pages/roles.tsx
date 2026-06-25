import React, { useState } from 'react';
import { SidebarLayout } from '@/components/layout/SidebarLayout';
import { useRoles, useCreateRole, useUpdateRole, useDeleteRole } from '@/hooks/use-team';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, Shield, ShieldCheck } from 'lucide-react';

const ALL_PERMISSIONS: { key: string; label: string; group: string }[] = [
  { key: 'dash_view', label: 'View Dashboard', group: 'Dashboard' },
  { key: 'dash_revenue', label: 'View Revenue', group: 'Dashboard' },
  { key: 'dash_mis', label: 'Command Center / MIS', group: 'Dashboard' },
  { key: 'leads_view_own', label: 'View Own Leads', group: 'Leads' },
  { key: 'leads_view_all', label: 'View All Leads', group: 'Leads' },
  { key: 'leads_create', label: 'Create Leads', group: 'Leads' },
  { key: 'leads_edit', label: 'Edit Leads', group: 'Leads' },
  { key: 'leads_assign', label: 'Assign Leads', group: 'Leads' },
  { key: 'leads_export', label: 'Export CSV', group: 'Leads' },
  { key: 'walkin_view', label: 'View Walk-ins', group: 'Walk-ins' },
  { key: 'walkin_register', label: 'Register Walk-in', group: 'Walk-ins' },
  { key: 'pay_view', label: 'View Payments', group: 'Payments' },
  { key: 'pay_record', label: 'Record Payment', group: 'Payments' },
  { key: 'svc_view', label: 'View Services', group: 'Services' },
  { key: 'svc_manage', label: 'Manage Services', group: 'Services' },
  { key: 'docs_upload', label: 'Upload Documents', group: 'Documents' },
  { key: 'docs_delete', label: 'Delete Documents', group: 'Documents' },
  { key: 'users_view', label: 'View Team', group: 'Team' },
  { key: 'users_manage', label: 'Manage Team', group: 'Team' },
  { key: 'roles_manage', label: 'Manage Roles', group: 'Access Control' },
];

const GROUPS = [...new Set(ALL_PERMISSIONS.map(p => p.group))];

function RoleModal({ open, onClose, role }: { open: boolean; onClose: () => void; role?: any }) {
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const { toast } = useToast();
  const isEdit = !!role;
  const [name, setName] = useState(role?.name || '');
  const [desc, setDesc] = useState(role?.description || '');
  const [perms, setPerms] = useState<string[]>(role?.permissions || []);

  const toggle = (key: string) =>
    setPerms(p => p.includes(key) ? p.filter(x => x !== key) : [...p, key]);

  const toggleGroup = (group: string) => {
    const groupKeys = ALL_PERMISSIONS.filter(p => p.group === group).map(p => p.key);
    const allOn = groupKeys.every(k => perms.includes(k));
    if (allOn) {
      setPerms(p => p.filter(k => !groupKeys.includes(k)));
    } else {
      setPerms(p => [...new Set([...p, ...groupKeys])]);
    }
  };

  const handleSave = async () => {
    if (!name) { toast({ title: 'Role name is required', variant: 'destructive' }); return; }
    try {
      const payload = { name, description: desc, permissions: perms };
      if (isEdit) {
        await updateRole.mutateAsync({ id: role.id, updates: payload });
        toast({ title: 'Role updated' });
      } else {
        await createRole.mutateAsync(payload);
        toast({ title: 'Role created' });
      }
      onClose();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEdit ? 'Edit Role' : 'New Role'}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Role Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Senior Agent" />
          </div>
          <div>
            <Label>Description</Label>
            <Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Brief description" />
          </div>
          <div>
            <Label className="mb-3 block">Permissions</Label>
            <div className="space-y-4">
              {GROUPS.map(group => {
                const groupPerms = ALL_PERMISSIONS.filter(p => p.group === group);
                const allOn = groupPerms.every(p => perms.includes(p.key));
                const someOn = groupPerms.some(p => perms.includes(p.key));
                return (
                  <div key={group}>
                    <div className="flex items-center gap-2 mb-2">
                      <input type="checkbox" checked={allOn} ref={el => { if (el) el.indeterminate = someOn && !allOn; }}
                        onChange={() => toggleGroup(group)} className="w-4 h-4" />
                      <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{group}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pl-6">
                      {groupPerms.map(p => (
                        <label key={p.key} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="checkbox" checked={perms.includes(p.key)} onChange={() => toggle(p.key)} className="w-3.5 h-3.5" />
                          {p.label}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={createRole.isPending || updateRole.isPending}>
            {isEdit ? 'Save' : 'Create Role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Roles() {
  const { can } = useAuth();
  const { data: roles, isLoading } = useRoles();
  const deleteRole = useDeleteRole();
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editRole, setEditRole] = useState<any>(null);

  const handleDelete = async (role: any) => {
    if (!window.confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    try {
      await deleteRole.mutateAsync(role.id);
      toast({ title: `Role "${role.name}" deleted` });
    } catch (e: any) {
      toast({ title: 'Cannot delete role', description: e.message, variant: 'destructive' });
    }
  };

  if (!can('roles_manage')) {
    return <SidebarLayout><div className="p-8 text-muted-foreground">Access denied.</div></SidebarLayout>;
  }

  return (
    <SidebarLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Roles & Permissions</h1>
            <p className="text-muted-foreground">Configure access control for your team.</p>
          </div>
          <Button onClick={() => { setEditRole(null); setModalOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> New Role
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">Loading...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {roles?.map(role => (
              <Card key={role.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      {role.is_preset ? <ShieldCheck className="h-5 w-5 text-primary" /> : <Shield className="h-5 w-5 text-muted-foreground" />}
                      <CardTitle className="text-base">{role.name}</CardTitle>
                      {role.is_preset && <Badge variant="secondary" className="text-xs">System</Badge>}
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => { setEditRole(role); setModalOpen(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {!role.is_preset && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(role)} disabled={deleteRole.isPending}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {role.description && <p className="text-sm text-muted-foreground">{role.description}</p>}
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {(role.permissions || []).length === 0 ? (
                      <span className="text-xs text-muted-foreground">No permissions assigned</span>
                    ) : (role.permissions || []).map((perm: string) => {
                      const def = ALL_PERMISSIONS.find(p => p.key === perm);
                      return (
                        <Badge key={perm} variant="outline" className="text-xs">
                          {def?.label || perm}
                        </Badge>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <RoleModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditRole(null); }}
        role={editRole}
      />
    </SidebarLayout>
  );
}
