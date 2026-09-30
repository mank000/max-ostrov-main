import { SelectField } from '../../../frontend/src/ui/components/SelectField'

export function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Record<string, string>
  onChange: (value: string) => void
}) {
  return (
    <SelectField
      label={label}
      value={value}
      options={Object.entries(options).map(([value, label]) => ({ value, label }))}
      onChange={onChange}
    />
  )
}
