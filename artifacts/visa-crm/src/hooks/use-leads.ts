import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

async function logActivity(opts: {
  action: string;
  entity_type: string;
  entity_id?: string;
  description: string;
}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    let actor_name: string | null = null;
    if (user) {
      const { data: p } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
      actor_name = p?.full_name ?? null;
    }
    await supabase.from('activity_log').insert([{
      ...opts,
      entity_id: opts.entity_id ?? null,
      actor_id: user?.id ?? null,
      actor_name,
    }]);
  } catch {
    // Non-critical — swallow silently
  }
}

export function useLeads(filters?: { status?: string, source?: string, agent?: string, search?: string }) {
  return useQuery({
    queryKey: ['leads', filters],
    queryFn: async () => {
      let query = supabase
        .from('leads')
        .select('*, service:services(name, category, country), agent:profiles!assigned_to(id, full_name, avatar_color)')
        .order('created_at', { ascending: false });

      if (filters?.status && filters.status !== 'All') query = query.eq('status', filters.status);
      if (filters?.source && filters.source !== 'All') query = query.eq('source', filters.source);
      if (filters?.agent && filters.agent !== 'All') query = query.eq('assigned_to', filters.agent);
      if (filters?.search) {
        query = query.or(`pax_name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
  });
}

export function useLead(id: string) {
  return useQuery({
    queryKey: ['leads', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('leads')
        .select('*, service:services(*), agent:profiles!assigned_to(*)')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id
  });
}

export function useLeadNotes(id: string) {
  return useQuery({
    queryKey: ['lead_notes', id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from('lead_notes')
        .select('*')
        .eq('lead_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id
  });
}

export function useLeadPayments(id: string) {
  return useQuery({
    queryKey: ['lead_payments', id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from('lead_payments')
        .select('*')
        .eq('lead_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id
  });
}

export function useLeadDocuments(id: string) {
  return useQuery({
    queryKey: ['lead_documents', id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from('lead_documents')
        .select('*')
        .eq('lead_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id
  });
}

export function useLeadHistory(id: string) {
  return useQuery({
    queryKey: ['lead_history', id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from('lead_status_history')
        .select('*')
        .eq('lead_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id
  });
}

export function useCreateLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (lead: any) => {
      const { data, error } = await supabase.from('leads').insert([lead]).select().single();
      if (error) throw error;
      
      if (data) {
        await supabase.from('lead_status_history').insert([{
          lead_id: data.id,
          status: data.status,
          note: 'Lead created',
        }]);
        logActivity({
          action: 'create_lead',
          entity_type: 'lead',
          entity_id: data.id,
          description: `New lead created for ${data.pax_name}${data.service_name ? ` — ${data.service_name}` : ''}`,
        });
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    }
  });
}

export function useUpdateLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates, logStatus }: { id: string, updates: any, logStatus?: boolean }) => {
      const { data, error } = await supabase.from('leads').update(updates).eq('id', id).select().single();
      if (error) throw error;

      if (logStatus && updates.status) {
        await supabase.from('lead_status_history').insert([{
          lead_id: id,
          status: updates.status,
          note: 'Status updated manually',
        }]);
        logActivity({
          action: 'update_status',
          entity_type: 'lead',
          entity_id: id,
          description: `Lead status changed to "${updates.status}"${data.pax_name ? ` for ${data.pax_name}` : ''}`,
        });
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', data.id] });
    }
  });
}

export function useCreateLeadNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (note: any) => {
      const { data, error } = await supabase.from('lead_notes').insert([note]).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['lead_notes', data.lead_id] });
    }
  });
}

export function useDeleteLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, pax_name }: { id: string; pax_name: string }) => {
      // Delete related records first (in case DB lacks CASCADE)
      await supabase.from('lead_notes').delete().eq('lead_id', id);
      await supabase.from('lead_payments').delete().eq('lead_id', id);
      await supabase.from('lead_documents').delete().eq('lead_id', id);
      await supabase.from('lead_status_history').delete().eq('lead_id', id);
      const { error } = await supabase.from('leads').delete().eq('id', id);
      if (error) throw error;
      logActivity({
        action: 'delete_lead',
        entity_type: 'lead',
        entity_id: id,
        description: `Lead deleted: ${pax_name}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateLeadPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const { data, error } = await supabase.from('lead_payments').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['lead_payments', data.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useBulkDeleteLeads() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (leads: { id: string; pax_name: string }[]) => {
      for (const { id, pax_name } of leads) {
        await supabase.from('lead_notes').delete().eq('lead_id', id);
        await supabase.from('lead_payments').delete().eq('lead_id', id);
        await supabase.from('lead_documents').delete().eq('lead_id', id);
        await supabase.from('lead_status_history').delete().eq('lead_id', id);
        const { error } = await supabase.from('leads').delete().eq('id', id);
        if (error) throw error;
        logActivity({
          action: 'delete_lead',
          entity_type: 'lead',
          entity_id: id,
          description: `Lead deleted: ${pax_name}`,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useCreateLeadPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payment: any) => {
      const { data, error } = await supabase.from('lead_payments').insert([payment]).select().single();
      if (error) throw error;
      logActivity({
        action: 'record_payment',
        entity_type: 'payment',
        entity_id: payment.lead_id,
        description: `Payment of ₹${payment.amount} recorded via ${payment.method || 'Cash'}`,
      });
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['lead_payments', data.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', data.lead_id] });
    }
  });
}

export function useLeadServices(leadId: string) {
  return useQuery({
    queryKey: ['lead_services', leadId],
    queryFn: async () => {
      if (!leadId) return [];
      const { data, error } = await supabase
        .from('lead_services')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!leadId,
  });
}

export function useCreateLeadService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (svc: { lead_id: string; service_id?: string | null; service_name: string; base_fee: number; payment_method: string; notes?: string | null }) => {
      const { data, error } = await supabase.from('lead_services').insert([svc]).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['lead_services', data.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', data.lead_id] });
    },
  });
}

export function useUpdateLeadService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const { data, error } = await supabase.from('lead_services').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['lead_services', data.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', data.lead_id] });
    },
  });
}

export function useDeleteLeadService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, leadId }: { id: string; leadId: string }) => {
      const { error } = await supabase.from('lead_services').delete().eq('id', id);
      if (error) throw error;
      return { leadId };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['lead_services', variables.leadId] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', variables.leadId] });
    },
  });
}
