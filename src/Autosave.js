import React from "react";
import { Subject, Observable } from "rxjs";
import propTypes from "prop-types";

class SaveStatus {
  constructor() {
    this.subscriptions = [];
  }

  setSaved = saved => {
    this.subscriptions.forEach(f => f({ saved }));
  };

  setSinceSave = sinceSave => {
    this.subscriptions.forEach(f => f({ sinceSave }));
  };

  subscribe(f) {
    this.subscriptions.push(f);
  }
}

export default class AutoSave extends React.Component {
  static defaultProps = {
    frequency: 1000,
    map: x => x
  };

  static propTypes = {
    renderLoading: propTypes.func,
    renderError: propTypes.func,
    render: propTypes.func,
    frequency: propTypes.number,
    onLoad: propTypes.func,
    onSave: propTypes.func,
    map: propTypes.func
  };

  static childContextTypes = {
    saveStatus: propTypes.object
  };

  state = {
    initialValues: null,
    status: "LOADING",
    saved: false,
    justSaved: false
  };

  saveStatus = new SaveStatus();
  manualSaveSubject = new Subject();
  // mapping fn as prop allows us to ignore fields
  onChangeSubject = new Subject().map(this.props.map).distinctUntilChanged();
  saveSuccessSubject = new Subject();
  unmountSubject = new Subject().take(1);

  onChange = value => this.onChangeSubject.next(value);
  manualSave = value => this.manualSaveSubject.next(value);
  saveNum = 0;

  componentWillMount() {
    const { onLoad, onSave, frequency } = this.props;
    const {
      onChangeSubject,
      manualSaveSubject,
      saveSuccessSubject,
      unmountSubject,
      saveStatus
    } = this;

    // converting promise to observable allows us to unsubscribe
    const load$ = Observable.fromPromise(onLoad()).takeUntil(unmountSubject);

    this.loadSubscription = load$.subscribe(
      initialValues =>
        this.setState({
          initialValues,
          status: "LOADED"
        }),
      error => this.setState({ status: "ERROR", error })
    );

    // each save window last till manual save or delay after change
    const nextSave = Observable.merge(
      onChangeSubject.delay(frequency),
      manualSaveSubject
    );

    const saveData = Observable.never()
      // split blank observer into windows by nextSave
      .windowWhen(() => nextSave)
      // group each blank window in array with latest data from onChange
      .withLatestFrom(onChangeSubject)
      // onChange date will be item 1 in array
      .map(x => x[1])
      // unsubscribe on componentWillUnmount
      .takeUntil(unmountSubject);

    // create id for each change
    const changeId = onChangeSubject.scan(x => x + 1, 0);

    // isSaved if saveId === changeId
    const isSaved = Observable.combineLatest(changeId, saveSuccessSubject)
      .map(([x, y]) => x === y)
      .distinctUntilChanged()
      .takeUntil(unmountSubject);

    // on each save start a timer
    const sinceSave = saveSuccessSubject
      .switchMap(() => Observable.timer(0, 1000))
      .takeUntil(unmountSubject);

    saveData
      .withLatestFrom(changeId)
      .map(([value, id]) => ({ value, id }))
      .subscribe(({ value, id }) => {
        onSave(value).then(() => saveSuccessSubject.next(id));
      });

    isSaved.subscribe(saveStatus.setSaved);
    sinceSave.subscribe(saveStatus.setSinceSave);
  }

  componentWillUnmount() {
    this.unmountSubject.next(true);
  }

  getChildContext() {
    return { saveStatus: this.saveStatus };
  }

  render() {
    const { render, renderLoading, renderError } = this.props;
    const { initialValues, status, error, saved, lastSaved } = this.state;
    const { onChange, manualSave } = this;

    if (status === "ERROR" && renderError) {
      return renderError(error);
    }

    if (status === "LOADING" && renderLoading) {
      return renderLoading();
    }

    return render({
      initialValues,
      status,
      manualSave,
      onChange,
      saved,
      lastSaved
    });
  }
}
