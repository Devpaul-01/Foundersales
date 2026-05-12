
// ============================================================
// FILE: src/pages/pipeline/DealDetailPage.tsx
// ============================================================
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { pipelineApi }  from '@/api/pipeline';
import { queryClient }  from '@/lib/queryClient';
import { queryKeys }    from '@/lib/queryKeys';
import { useToast }     from '@/hooks/useToast';
import { Button }       from '@/components/ui/Button';
import { Badge }        from '@/components/ui/Badge';
import { Input }        from '@/components/ui/Input';
import { Modal }        from '@/components/ui/Modal';
import { Skeleton }     from '@/components/ui/Skeleton';
import { InlineAlert, PageLoader, ConfirmDialog } from '@/components/common/index';
import { STAGE_LABELS, STAGE_COLORS } from '@/lib/constants';
import { formatRelativeDate, formatCurrency, cn } from '@/lib/utils';
import { ArrowLeft, DollarSign, Trash2 } from 'lucide-react';

export default function DealDetailPage() {
  const { id }        = useParams<{ id: string }>();
  const navigate      = useNavigate();
  const { showToast } = useToast();
  const [dealValueOpen,  setDealValueOpen]  = useState(false);
  const [dealValueInput, setDealValueInput] = useState('');
  const [deleteOpen,     setDeleteOpen]     = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.deal(id!),
    queryFn:  () => pipelineApi.getDeal(id!).then((r) => r.data.deal),
    enabled:  !!id,
  });

  const dealValueMutation = useMutation({
    mutationFn: (v: number) => pipelineApi.updateDealValue(id!, v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deal(id!) });
      showToast('Deal value updated.', 'success');
      setDealValueOpen(false);
    },
    onError: () => showToast('Could not update deal value.', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => pipelineApi.deleteDeal(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipeline() });
      navigate('/pipeline');
      showToast('Deal removed from pipeline.', 'info');
    },
    onError: () => showToast('Could not delete deal.', 'error'),
  });

  if (isLoading) return <PageLoader />;
  if (!data) return (
    <div className="page-container">
      <InlineAlert type="error" message="Deal not found." />
    </div>
  );

  const stageColor = STAGE_COLORS[data.stage] ?? '#64748b';

  return (
    <div className="page-container max-w-2xl space-y-5">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary">
        <ArrowLeft size={14} /> Pipeline
      </button>

      <div className="bg-white border border-surface-border rounded-lg p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">
              {data.target_name ?? 'Unnamed deal'}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ backgroundColor: `${stageColor}18`, color: stageColor, border: `1px solid ${stageColor}40` }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stageColor }} />
                {STAGE_LABELS[data.stage]}
              </span>
              <span className="text-xs text-text-muted">{data.platform}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="xs"
              variant="secondary"
              leftIcon={<DollarSign size={12} />}
              onClick={() => { setDealValueInput(String(data.feedback?.[0]?.deal_value_usd ?? '')); setDealValueOpen(true); }}
            >
              {data.feedback?.[0]?.deal_value_usd
                ? formatCurrency(data.feedback[0].deal_value_usd)
                : 'Set value'}
            </Button>
            <Button
              size="xs"
              variant="destructive"
              leftIcon={<Trash2 size={12} />}
              onClick={() => setDeleteOpen(true)}
            >
              Remove
            </Button>
          </div>
        </div>

        <p className="text-sm text-text-secondary leading-relaxed">{data.target_context}</p>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-text-muted">Score</p>
            <p className="font-mono font-bold text-text-primary">{Math.round(data.composite_score)}/100</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Last activity</p>
            <p className="text-text-primary">{formatRelativeDate(data.last_stage_changed_at ?? data.created_at)}</p>
          </div>
          {data.feedback?.[0]?.scheduled_call_date && (
            <div className="col-span-2">
              <p className="text-xs text-text-muted">Scheduled call</p>
              <p className="text-text-primary">{formatRelativeDate(data.feedback[0].scheduled_call_date)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Deal value modal */}
      <Modal isOpen={dealValueOpen} onClose={() => setDealValueOpen(false)} title="Set deal value" size="sm">
        <Input
          label="Deal value (USD)"
          type="number"
          placeholder="0"
          value={dealValueInput}
          onChange={(e) => setDealValueInput(e.target.value)}
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" size="sm" onClick={() => setDealValueOpen(false)}>Cancel</Button>
          <Button
            size="sm"
            isLoading={dealValueMutation.isPending}
            onClick={() => dealValueMutation.mutate(parseFloat(dealValueInput) || 0)}
          >
            Save
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Remove deal"
        message="This will permanently remove the deal from your pipeline. This cannot be undone."
        confirmLabel="Remove deal"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
