import { FakeHidDevice } from '@/hid/core/testing/fakeHidDevice'
import { WebHidTransport } from '@/hid/core/transport'
import { CompxMouseDriver } from '@/drivers/compx/driver'
import { REPORT_ID } from '@/drivers/compx/frame'
import { COMPX_VID } from '@/drivers/registry'
import type { LinkType } from '@/model/device'
import { CompxMouseFirmware, type CompxSimOptions } from './firmware'

export interface SimCompxMouse {
  device: FakeHidDevice
  firmware: CompxMouseFirmware
  link: LinkType
  openDriver(): Promise<CompxMouseDriver>
}

export function createSimCompxMouse(options: CompxSimOptions & { link?: LinkType } = {}): SimCompxMouse {
  const link = options.link ?? 'wired'
  const typeByte = options.typeByte ?? (link === 'wired' ? 2 : 0)
  const device = new FakeHidDevice('Mercury M1 Pro', COMPX_VID, link === 'wired' ? 0xf549 : 0xf54b, REPORT_ID)
  const firmware = new CompxMouseFirmware({ ...options, typeByte }).attach(device)
  return {
    device,
    firmware,
    link,
    async openDriver() {
      const driver = CompxMouseDriver.fromTransport(await WebHidTransport.open(device, REPORT_ID), link)
      await driver.connect()
      return driver
    },
  }
}
