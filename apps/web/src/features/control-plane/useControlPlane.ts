import { useContext } from 'react'
import { ControlPlaneContext } from './context'

export function useControlPlane() {
  const value = useContext(ControlPlaneContext)
  if (!value) throw new Error('useControlPlane must be used within ControlPlaneProvider')
  return value
}
