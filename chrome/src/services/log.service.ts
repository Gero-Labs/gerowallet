import { config } from '../config';
import { autoInjectable, singleton } from 'tsyringe';
import { GERO_CARDANO_SERVER } from '../constants';
import { debounceTime, Subject } from 'rxjs';

@singleton()
@autoInjectable()
export class LogService {
    private errorReceivedSubject = new Subject();
    private errorReceived$ = this.errorReceivedSubject.asObservable().pipe( debounceTime( 3000 ) );

    private errorsArray: any[] = [];

    constructor() {
        // init the subscription to post errors to backend
        if (config.logzioEnabled) {
            this.initErrorListener();
        }
    }


    public log(msg: any) {
        if (config.enableConsoleLogs) {
            console.log( msg );
        }
        if (config.logzioEnabled) {
            this.errorsArray.push( msg );
            this.errorReceivedSubject.next( null );
        }
    }

    private initErrorListener(): void {
        this.errorReceived$.subscribe( async () => {
            await this.postErrorsToBackend();
        } );
    }

    private async postErrorsToBackend(): Promise<void> {
        if (this.errorsArray.length > 0) {
            const errorsToBePosted = {
                errors: this.errorsArray.map( error => {
                    return {
                        error: {
                            name: error?.name ? error.name : 'Chrome Error Handler - Generic Error',
                            message: error?.message ?? error
                        }
                    }
                } )
            };

            await this.post( errorsToBePosted );
        }

    }

    private async post(errorsToBePosted): Promise<void> {
        const result  = await fetch( `${GERO_CARDANO_SERVER}/handle/error`, {
            headers: {
                'Content-Type': 'application/json',
            },
            method: 'POST',
            body: JSON.stringify( errorsToBePosted ),
        } );

        result.json().then( (response) => {
            if (response.status === 200) {
                this.errorsArray = [];
            }
        })
    }

}
