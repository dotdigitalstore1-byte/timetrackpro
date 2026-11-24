import { useRoute, type RouteProp } from '@react-navigation/native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { salarySlip } from '../api/endpoints';
import { Card, ErrorBox, KeyValue, PrimaryButton, ScreenScroll, Skeleton, StatusBanner, StatusChip } from '../components/ui';
import { useSession } from '../auth/SessionContext';
import { scopedKey, useResource } from '../data/useResource';
import { formatDateKey, formatDays, formatMoney, humanize, num } from '../format';
import type { RootStackParamList } from '../navigation/types';
import { buildSlipHtml } from '../slip/html';
import { colors } from '../theme';

const DAY_KEY = /day|count/i;

/** One approved salary slip. Saving makes a PDF on the phone and opens the share sheet. */
export function SalarySlipScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'SalarySlip'>>();
  const { user } = useSession();
  const requestId = route.params.requestId;
  const state = useResource(scopedKey(user?.id ?? null, `slip:${requestId}`), () => salarySlip(requestId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slip = state.data;
  const currency = 'INR';

  const save = async () => {
    if (!slip || saving) return;
    setSaving(true);
    setError(null);
    try {
      const title = `Salary slip · ${formatDateKey(slip.period.start)} – ${formatDateKey(slip.period.end)}`;
      const { uri } = await Print.printToFileAsync({ html: buildSlipHtml(slip, currency, title) });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Salary slip' });
      }
    } catch {
      setError('Could not create the PDF on this phone. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenScroll onRefresh={state.refresh}>
      <StatusBanner state={state} />
      {slip ? (
        <>
          <Card>
            <Text style={styles.name}>{slip.employee.name}</Text>
            <Text style={styles.meta}>{[slip.employee.designation, slip.employee.code ? `ID ${slip.employee.code}` : null].filter(Boolean).join(' · ')}</Text>
            <StatusChip status={slip.provisional ? 'pending' : slip.status} label={slip.provisional ? 'Provisional' : humanize(slip.status)} />
            <KeyValue label="Period" value={`${formatDateKey(slip.period.start)} – ${formatDateKey(slip.period.end)}`} />
            <KeyValue label="Pay date" value={formatDateKey(slip.disbursementDate ?? slip.salaryDate ?? null)} />
            {slip.availableUntil ? <KeyValue label="Available until" value={formatDateKey(slip.availableUntil.slice(0, 10))} /> : null}
          </Card>
          <Card>
            {Object.entries(slip.breakdown)
              .filter(([, v]) => v !== null && v !== '' && Number.isFinite(num(v)))
              .map(([k, v]) => (
                <KeyValue
                  key={k}
                  label={humanize(k.replace(/([A-Z])/g, ' $1').toLowerCase())}
                  value={DAY_KEY.test(k) ? formatDays(num(v)) : formatMoney(num(v), currency)}
                  emphasize={/net/i.test(k)}
                />
              ))}
          </Card>
          {error ? <ErrorBox message={error} /> : null}
          <PrimaryButton label={saving ? 'Preparing PDF…' : 'Save as PDF'} onPress={save} disabled={saving} />
        </>
      ) : state.error ? (
        <ErrorBox message={state.error} />
      ) : (
        <>
          <Skeleton height={160} />
          <Skeleton height={220} />
        </>
      )}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 18, fontWeight: '700', color: colors.slate900 },
  meta: { fontSize: 13, color: colors.slate500, marginTop: 2, marginBottom: 10 },
});
